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
  type PlanCode,
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

  async quota(tenantId: string, planCode: PlanCode): Promise<SearchQuotaResponse> {
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
    planCode: PlanCode,
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

    const existing = await this.prisma.scrapeJob.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });

    if (existing) {
      return { searchId: existing.searchId, jobId: existing.id };
    }

    const search = await this.prisma.prospectingSearch.create({
      data: {
        tenantId,
        createdById: userId,
        niche: dto.niche,
        stateUf: dto.stateUf.toUpperCase(),
        city: dto.city,
        neighborhood: dto.neighborhood ?? null,
        radiusKm: dto.radiusKm ?? 10,
        requestedCount: requested,
      },
    });

    const job = await this.prisma.scrapeJob.create({
      data: {
        tenantId,
        searchId: search.id,
        status: 'QUEUED',
        idempotencyKey,
        keyword,
        queuedAt: new Date(),
      },
    });

    await this.prisma.planUsage.update({
      where: {
        tenantId_periodStart: {
          tenantId,
          periodStart: (await this.entitlements.currentUsage(tenantId)).periodStart,
        },
      },
      data: {
        leadsReserved: { increment: requested },
        searchesCount: { increment: 1 },
      },
    });

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

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'prospecting.search.created',
        entityType: 'ProspectingSearch',
        entityId: search.id,
        after: { keyword, requested },
      },
    });

    return { searchId: search.id, jobId: job.id };
  }

  async status(tenantId: string, searchId: string): Promise<SearchStatusResponse> {
    const job = await this.prisma.scrapeJob.findFirst({
      where: { tenantId, searchId },
      orderBy: { createdAt: 'desc' },
    });

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
