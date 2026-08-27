import { createHash } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JOB_PROGRESS,
  buildSearchKeyword,
  fingerprintInput,
  type ScrapeJobStatus,
  type SearchQuotaResponse,
  type SearchStatusResponse,
} from '@propectai/types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSearchDto } from './prospecting.dto';

/**
 * O BullMQ usa `:` como separador das chaves no Redis e por isso o proíbe no
 * nome da fila. O isolamento vem do `prefix`, que é o mecanismo próprio dele —
 * as chaves ficam como `propectai:scrape:*`.
 *
 * Nome e prefixo precisam ser idênticos aqui e em apps/worker/src/config.ts,
 * senão a API publica numa fila e o worker escuta outra.
 */
const QUEUE_NAME = 'scrape';
const QUEUE_PREFIX = 'propectai';

@Injectable()
export class ProspectingService implements OnModuleDestroy {
  private readonly queue: Queue;

  private readonly connection: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    config: ConfigService,
  ) {
    // Instância explícita do ioredis: o tipo de conexão do BullMQ é
    // RedisOptions, que não aceita a chave `url`. Passar a URL para o
    // construtor do ioredis é o caminho suportado.
    this.connection = new IORedis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6381',
      { maxRetriesPerRequest: null },
    );

    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  /**
   * Libera fila e conexão no encerramento.
   *
   * O BullMQ não é dono de conexão recebida pronta — fechar a fila não fecha o
   * ioredis. Sem os dois, o processo não termina: em teste o Jest avisa
   * "did not exit one second after the test run", e em produção o SIGTERM não
   * derruba o container, que só morre no kill forçado do orquestrador.
   *
   * Descoberto em 31/07/2026 pelo teste de isolamento HTTP, que sobe o
   * AppModule inteiro — a suíte anterior falava direto com o Prisma e nunca
   * exercitou o ciclo de vida da aplicação.
   */
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }

  async quota(tenantId: string, planCode: string): Promise<SearchQuotaResponse> {
    const limits = this.entitlements.limits(planCode);
    const usage = await this.entitlements.currentUsage(tenantId);

    return {
      planCode,
      leadsIncluded: limits.leadsIncluded,
      leadsUsed: usage.leadsReserved + usage.leadsSettled,
      available: await this.entitlements.availableLeadCredits(tenantId, planCode),
    };
  }

  /**
   * Cria a busca e enfileira o job.
   *
   * A cota é RESERVADA aqui e liquidada pelo worker com o número real de
   * leads novos. Duplicado não consome; job que falha devolve a reserva.
   * Reservar no início evita que buscas simultâneas estourem o limite.
   */
  async createSearch(
    tenantId: string,
    userId: string,
    planCode: string,
    dto: CreateSearchDto,
  ): Promise<{ searchId: string; jobId: string }> {
    const available = await this.entitlements.availableLeadCredits(tenantId, planCode);

    if (available <= 0) {
      throw new ForbiddenException({
        message: 'Seu plano não tem leads disponíveis neste período',
        code: 'PLAN_LIMIT',
        capability: 'leads.quota',
      });
    }

    const requested = Math.min(dto.requestedCount ?? 5, available);

    const keyword = buildSearchKeyword({
      niche: dto.niche,
      city: dto.city,
      stateUf: dto.stateUf,
      neighborhood: dto.neighborhood,
    });

    // Chave idempotente: reenviar a mesma busca no mesmo dia devolve o job
    // existente em vez de criar outro e cobrar de novo.
    const idempotencyKey = createHash('sha256')
      .update(
        fingerprintInput(keyword, null, null) +
          `|${dto.radiusKm ?? 10}|${requested}|${new Date().toISOString().slice(0, 10)}`,
      )
      .digest('hex')
      .slice(0, 32);

    const existing = await this.prisma.comTenant(tenantId, (tx) =>
      tx.scrapeJob.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      }),
    );

    if (existing) {
      return { searchId: existing.searchId, jobId: existing.id };
    }

    /**
     * O `periodStart` sai daqui de propósito.
     *
     * Antes ele era calculado **dentro** do `where` do `planUsage.update`, com
     * um `await this.entitlements.currentUsage(...)` embutido na cláusula. O
     * `EntitlementsService` usa o próprio client, então essa chamada nunca
     * estaria dentro do bloco de qualquer forma — deixá-la ali só escondia isso.
     */
    const { periodStart } = await this.entitlements.currentUsage(tenantId);

    /**
     * Busca, job, reserva de cota e registro — num bloco só.
     *
     * Eram quatro escritas soltas: se a reserva de cota falhasse, a busca e o
     * job já estavam gravados e o cliente ficava com uma busca que nunca cobrou
     * e nunca rodaria direito. Agora vivem ou morrem juntas.
     *
     * O `queue.add` fica **fora**, depois do commit: Redis não entra em
     * transação do Postgres. A ordem — grava, depois publica — é a mesma de
     * antes e a mesma do `AuditsService`.
     */
    let search: { id: string };
    let job: { id: string };

    try {
      ({ search, job } = await this.prisma.comTenant(tenantId, async (tx) => {
        const search = await tx.prospectingSearch.create({
          data: {
            tenantId,
            createdById: userId,
            niche: dto.niche,
            stateUf: dto.stateUf.toUpperCase(),
            city: dto.city,
            neighborhood: dto.neighborhood ?? null,
            radiusKm: dto.radiusKm ?? 10,
            requestedCount: requested,
            // Só quando o nicho veio de sugestão. O worker usa isto ao concluir o
            // job para decidir se o termo sugerido se comprovou naquele país.
            segmentLocaleId: dto.segmentLocaleId ?? null,
          },
        });

        const job = await tx.scrapeJob.create({
          data: {
            tenantId,
            searchId: search.id,
            status: 'QUEUED',
            idempotencyKey,
            keyword,
            queuedAt: new Date(),
          },
        });

        await tx.planUsage.update({
          where: { tenantId_periodStart: { tenantId, periodStart } },
          data: {
            leadsReserved: { increment: requested },
            searchesCount: { increment: 1 },
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: userId,
            action: 'prospecting.search.created',
            entityType: 'ProspectingSearch',
            entityId: search.id,
            after: { keyword, requested },
          },
        });

        return { search, job };
      }));
    } catch (erro) {
      /**
       * **Corrida perdida na chave de idempotência.**
       *
       * A conferência lá em cima não fecha a janela: entre ler e escrever cabe
       * outro pedido idêntico, e o único árbitro confiável é o índice único
       * `(tenantId, idempotencyKey)`. Sem este `catch`, dois cliques simultâneos
       * na mesma busca faziam o segundo estourar `P2002` sem tratamento — **500
       * na cara do usuário**, por uma busca que já existia.
       *
       * Mesmo defeito que o `AuditsService` tinha e que foi consertado em
       * 25/08. Aqui ele sobreviveu porque ninguém tinha olhado.
       *
       * **A cota não é cobrada duas vezes**: a reserva acontece dentro da
       * transação que o `P2002` aborta, então ela volta atrás junto.
       *
       * A leitura de recuperação abre **outra** transação de propósito — a
       * anterior morreu com o erro, e o Postgres recusa qualquer comando numa
       * transação abortada.
       */
      if ((erro as { code?: string }).code !== 'P2002') throw erro;

      const existente = await this.prisma.comTenant(tenantId, (tx) =>
        tx.scrapeJob.findFirstOrThrow({
          where: { tenantId, idempotencyKey },
          select: { id: true, searchId: true },
        }),
      );

      return { searchId: existente.searchId, jobId: existente.id };
    }

    await this.queue.add(
      'scrape',
      {
        tenantId,
        searchId: search.id,
        scrapeJobId: job.id,
        keyword,
        requestedCount: requested,
        radiusKm: dto.radiusKm ?? 10,
      },
      { jobId: job.id },
    );

    return { searchId: search.id, jobId: job.id };
  }

  async status(tenantId: string, searchId: string): Promise<SearchStatusResponse> {
    const job = await this.prisma.comTenant(tenantId, (tx) =>
      tx.scrapeJob.findFirst({
        where: { tenantId, searchId },
        orderBy: { createdAt: 'desc' },
      }),
    );

    if (!job) throw new NotFoundException('Busca não encontrada');

    const status = job.status as ScrapeJobStatus;
    const step = JOB_PROGRESS[status];

    return {
      searchId,
      jobId: job.id,
      status,
      progress: step.progress,
      message: step.message,
      resultCount: job.resultCount,
      newLeadCount: job.newLeadCount,
      duplicateCount: job.duplicateCount,
      errorMessage: job.errorMessage,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}
