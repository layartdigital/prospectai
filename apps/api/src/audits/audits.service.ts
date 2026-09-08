import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_VERSION, type SiteCheckResult } from '@propectai/types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { montarCsv } from '../common/csv';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAuditDto } from './audits.dto';

/**
 * Nome e prefixo precisam bater exatamente com `QUEUE_NAMES.audit` e
 * `QUEUE_PREFIX` de `apps/worker/src/config.ts`, senao a API publica numa fila
 * e o worker escuta outra — e o sintoma e o pior possivel: nada acontece, sem
 * erro em lugar nenhum.
 */
const QUEUE_NAME = 'audit';
const QUEUE_PREFIX = 'propectai';

/**
 * O prazo da auditoria e o da checagem que expira primeiro.
 *
 * Ver o comentario no `detalhe`: menor, nunca maior.
 */
function prazoDaAuditoria(
  checks: Array<{ retentionUntil: Date | null }>,
): string | null {
  const prazos = checks
    .map((c) => c.retentionUntil)
    .filter((d): d is Date => d !== null);

  if (prazos.length === 0) return null;

  return new Date(Math.min(...prazos.map((d) => d.getTime()))).toISOString();
}

/** Tem de bater com `AUDIT_TENTATIVAS` do worker: e o que decide o `FAILED`. */
const TENTATIVAS = 3;

/**
 * Janela da chave de idempotencia.
 *
 * O minuto fecha o clique duplo e o retry impaciente. Nao decide politica de
 * frescor — se uma auditoria de dez minutos atras deve ser reaproveitada e
 * decisao de produto, e esta constante nao e o lugar de responde-la.
 */
function chaveDoMinuto(leadId: string, agora: Date): string {
  return createHash('sha256')
    .update(`${leadId}|${AUDIT_VERSION}|${agora.toISOString().slice(0, 16)}`)
    .digest('hex')
    .slice(0, 32);
}

/** Estados dos quais a auditoria ainda pode sair sozinha. */
const EM_ANDAMENTO = ['REQUESTED', 'QUEUED', 'RUNNING'] as const;

export interface AuditoriaCriada {
  auditId: string;
  status: string;
  creditosRestantes: number;
  /**
   * `true` quando o pedido caiu numa auditoria que ja existia.
   *
   * Vai na resposta de proposito: a tela precisa saber a diferenca entre "sua
   * auditoria comecou" e "ja estamos medindo este lead", e sem o campo ela
   * mostraria a segunda como se fosse a primeira.
   */
  reaproveitada: boolean;
}

@Injectable()
export class AuditsService implements OnModuleDestroy {
  private readonly queue: Queue;

  private readonly connection: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    config: ConfigService,
  ) {
    this.connection = new IORedis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6381',
      { maxRetriesPerRequest: null },
    );

    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: TENTATIVAS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  /**
   * Fila e conexao liberadas no encerramento.
   *
   * Mesma razao documentada no `ProspectingService`: o BullMQ nao e dono de
   * conexao recebida pronta, e sem os dois o processo nao termina. Custou um
   * "did not exit one second after the test run" em 31/07/2026.
   */
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }

  async saldo(tenantId: string, planCode: string): Promise<{ disponivel: number; incluidas: number }> {
    return {
      disponivel: await this.entitlements.availableAuditCredits(tenantId, planCode),
      incluidas: this.entitlements.limits(planCode).auditsPerMonth,
    };
  }

  /**
   * Cria a auditoria e enfileira.
   *
   * O credito e consumido AQUI, na tentativa — e o worker devolve quando a
   * medicao nao acontece. Cobrar no fim deixaria auditorias simultaneas
   * estourarem o limite; cobrar no carregamento da tela puniria quem so abriu
   * o lead.
   *
   * ---
   *
   * **Duas transacoes, e o Redis fora das duas.** A ordem das conferencias e a
   * mesma de antes, mas o que era uma sequencia de consultas soltas passou a ser
   * `comTenant` — que abre transacao para declarar o tenant ao Postgres. Isso
   * impoe uma disciplina que a versao anterior nao precisava ter:
   *
   *   1. **`queue.add` fica fora.** Publicar no Redis dentro de uma transacao do
   *      Postgres seria segurar uma conexao do banco esperando outra rede.
   *   2. **A recuperacao do `P2002` fica fora.** Depois de um erro o Postgres
   *      aborta a transacao inteira; ler o registro existente ali dentro
   *      responderia `current transaction is aborted`.
   *   3. **As leituras de entitlement ficam fora**, porque o `EntitlementsService`
   *      usa o proprio client — o `tx` daqui nao alcanca. Nao ha problema hoje:
   *      `plan_usage` e `subscriptions` nao estao no canario do passo 4. **Mas e
   *      exatamente este o trabalho do passo 6**, e ele esta anotado aqui em vez
   *      de ser descoberto quando a leitura devolver zero.
   */
  async criar(
    tenantId: string,
    userId: string,
    planCode: string,
    dto: CreateAuditDto,
  ): Promise<AuditoriaCriada> {
    // Gate de plano antes de qualquer escrita. `assert` so e chamado porque o
    // usuario pediu a acao — carregar tela nunca passa por aqui (regra 5).
    this.entitlements.assert(planCode, 'audit.run');

    const preparo = await this.prisma.comTenant(tenantId, async (tx) => {
      // Chave composta: um `leadId` de outro tenant simplesmente nao existe aqui.
      const lead = await tx.lead.findUnique({
        where: { tenantId_id: { tenantId, id: dto.leadId } },
        select: { id: true, website: true },
      });

      if (lead === null) return { tipo: 'sem-lead' as const };

      /**
       * **Lead sem site nao vira auditoria, e nao consome credito.**
       *
       * Regra 4: campo vazio no Google Maps e `DESCONHECIDO`, nao `AUSENTE`. Uma
       * auditoria de sete `SKIPPED` seria um relatorio afirmando ausencia de
       * presenca digital a partir de ausencia de dado — e cobrar por ela seria
       * cobrar por uma medicao que nao aconteceu.
       *
       * Recusar aqui, e nao no worker, poupa a viagem inteira pela fila.
       */
      if ((lead.website ?? '').trim() === '') return { tipo: 'sem-site' as const };

      /**
       * **Ja existe auditoria em andamento para este lead?**
       *
       * Fecha o caso comum: o usuario clica, nada parece acontecer, ele clica de
       * novo. Sem isto, cada clique criava auditoria propria e consumia credito
       * proprio — e num plano de tres por mes, dois cliques queimavam dois tercos
       * da cota medindo o mesmo site.
       */
      const emAndamento = await tx.digitalPresenceAudit.findFirst({
        where: { tenantId, leadId: lead.id, status: { in: [...EM_ANDAMENTO] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      });

      if (emAndamento !== null) {
        return { tipo: 'em-andamento' as const, auditoria: emAndamento };
      }

      return { tipo: 'pode-criar' as const, leadId: lead.id };
    });

    if (preparo.tipo === 'sem-lead') throw new NotFoundException('Lead não encontrado');

    if (preparo.tipo === 'sem-site') {
      throw new BadRequestException({
        message: 'Este lead não tem site cadastrado, então não há o que auditar',
        code: 'LEAD_SEM_SITE',
      });
    }

    /**
     * **Esta conferencia vem ANTES do gate de saldo, e a ordem e deliberada.**
     *
     * Quem ja tem uma auditoria rodando e esta sem credito nao esta pedindo uma
     * nova — esta perguntando pela que ja pagou. Responder 403 "sem saldo" ali
     * seria negar acesso a um trabalho que o cliente ja comprou, e e o tipo de
     * paywall que a regra 5 existe para impedir.
     *
     * Criar continua exigindo saldo: o gate abaixo so e alcancado quando nao ha
     * nada em andamento.
     */
    if (preparo.tipo === 'em-andamento') {
      return {
        auditId: preparo.auditoria.id,
        status: preparo.auditoria.status,
        creditosRestantes: await this.entitlements.availableAuditCredits(tenantId, planCode),
        reaproveitada: true,
      };
    }

    const disponivel = await this.entitlements.availableAuditCredits(tenantId, planCode);
    if (disponivel <= 0) {
      throw new ForbiddenException({
        message: 'Seu plano não tem auditorias disponíveis neste período',
        code: 'PLAN_LIMIT',
        capability: 'audit.run',
      });
    }

    const { periodStart } = await this.entitlements.currentUsage(tenantId);
    const idempotencyKey = chaveDoMinuto(preparo.leadId, new Date());

    let auditoria: { id: string; status: string };
    try {
      auditoria = await this.prisma.comTenant(tenantId, async (tx) => {
        const criada = await tx.digitalPresenceAudit.create({
          data: {
            tenantId,
            leadId: preparo.leadId,
            requestedById: userId,
            auditVersion: AUDIT_VERSION,
            idempotencyKey,
            status: 'QUEUED',
          },
          select: { id: true, status: true },
        });

        await tx.planUsage.update({
          where: { tenantId_periodStart: { tenantId, periodStart } },
          data: { auditsCount: { increment: 1 } },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: userId,
            action: 'audit.presence.requested',
            entityType: 'DigitalPresenceAudit',
            entityId: criada.id,
            after: { leadId: preparo.leadId, auditVersion: AUDIT_VERSION },
          },
        });

        return criada;
      });
    } catch (erro) {
      /**
       * Corrida perdida: outro pedido gravou a mesma chave entre a conferencia
       * acima e este `create`. **A conferencia sozinha nao fecha a janela** —
       * entre ler e escrever cabe outro pedido, e o unico arbitro confiavel e o
       * indice unico.
       *
       * `P2002` e a violacao de unicidade do Prisma. Qualquer outro erro sobe.
       *
       * A leitura de recuperacao abre **outra** transacao de proposito: a
       * anterior morreu com o erro, e o Postgres recusa qualquer comando numa
       * transacao abortada.
       */
      if ((erro as { code?: string }).code !== 'P2002') throw erro;

      const existente = await this.prisma.comTenant(tenantId, (tx) =>
        tx.digitalPresenceAudit.findFirstOrThrow({
          where: { tenantId, idempotencyKey },
          select: { id: true, status: true },
        }),
      );

      return {
        auditId: existente.id,
        status: existente.status,
        creditosRestantes: disponivel,
        reaproveitada: true,
      };
    }

    /**
     * **`jobId` explicito, e igual ao id da auditoria.**
     *
     * E ele que o `decidirExecucao` do worker compara para separar retry
     * legitimo de mensagem forjada. Deixar o BullMQ sortear um id faria o
     * worker reivindicar um valor que a API nao conhece — e a defesa passaria
     * a comparar um numero com ele mesmo, o que nao prova nada.
     *
     * De brinde: o BullMQ recusa job repetido com o mesmo `jobId`, o que torna
     * o reenvio idempotente sem chave extra.
     *
     * Publicar **depois** do commit mantem a ordem que ja existia: a linha e
     * gravada antes da mensagem. A janela em que o commit passa e o `add` falha
     * continua aberta, e so um outbox a fecha — nao e trabalho deste passo, mas
     * fica dito.
     */
    await this.queue.add(
      'audit',
      { tenantId, auditId: auditoria.id },
      { jobId: auditoria.id },
    );

    return {
      auditId: auditoria.id,
      status: auditoria.status,
      creditosRestantes: disponivel - 1,
      reaproveitada: false,
    };
  }

  async detalhe(
    tenantId: string,
    auditId: string,
  ): Promise<{
    auditId: string;
    leadId: string;
    status: string;
    auditVersion: string;
    /** Qual implementacao mediu. Nulo enquanto a auditoria nao rodou. */
    providerName: string | null;
    durationMs: number | null;
    errorCode: string | null;
    finishedAt: string | null;
    /**
     * Ate quando as medicoes ficam disponiveis. Nulo enquanto nao ha checagem.
     *
     * **E o MENOR `retentionUntil` das checagens, e nao o maior.** Elas sao
     * gravadas na mesma execucao e hoje coincidem, mas o schema permite
     * divergir — e nesse caso o maior seria uma promessa que o sistema nao
     * cumpre: a primeira medicao some antes. Prometer a data em que ainda esta
     * tudo la e a unica leitura honesta.
     */
    retentionUntil: string | null;
    checks: Array<Omit<SiteCheckResult, 'observedAt'> & { observedAt: string | null }>;
  }> {
    const a = await this.prisma.comTenant(tenantId, (tx) =>
      tx.digitalPresenceAudit.findUnique({
        where: { tenantId_id: { tenantId, id: auditId } },
        include: { checks: { orderBy: { createdAt: 'asc' } } },
      }),
    );

    if (a === null) throw new NotFoundException('Auditoria não encontrada');

    return {
      auditId: a.id,
      leadId: a.leadId,
      status: a.status,
      auditVersion: a.auditVersion,
      providerName: a.providerName,
      durationMs: a.durationMs,
      errorCode: a.errorCode,
      finishedAt: a.finishedAt?.toISOString() ?? null,
      /**
       * **Isto reverte uma decisao explicita, e a reversao e da D6.**
       *
       * Onde esta linha esta havia: "`retentionUntil` e `id` ficam de fora: sao
       * internos, e o que o cliente precisa e a medicao". O argumento estava
       * certo enquanto o prazo era so contabilidade nossa. A D6 mudou o que o
       * campo significa: com expurgo de verdade, a data deixa de ser interna e
       * passa a ser o aviso de que a medicao tem validade.
       *
       * O `id` da checagem continua de fora — esse segue interno.
       */
      retentionUntil: prazoDaAuditoria(a.checks),
      checks: a.checks.map((c) => ({
        check: c.check,
        outcome: c.outcome,
        observedUrl: c.observedUrl,
        observedAt: c.observedAt?.toISOString() ?? null,
        result: c.result as Record<string, string | number | boolean | null> | null,
        errorCode: c.errorCode,
        confidence: c.confidence,
      })),
    };
  }

  /**
   * Exporta a auditoria e suas checagens em CSV — peca 2 da D6.
   *
   * **Por que existe:** as medicoes tem prazo (180 dias), e prazo sem saida e
   * so perda agendada. Esta rota e o que transforma "vamos apagar" em "leve
   * antes de apagarmos".
   *
   * ---
   *
   * **CSV, e nao JSON.** A D6 admitia os dois. CSV porque e o mesmo formato do
   * `GET /leads/export` — o publico deste produto abre planilha, e duas rotas de
   * export com formatos diferentes obrigam a pessoa a aprender duas vezes. O
   * unico campo que sofre e o `result`, que e Json e vira texto numa celula;
   * nada se perde, so fica feio de ler. Acrescentar `?format=json` depois e
   * aditivo e nao quebra ninguem.
   *
   * **Uma linha por checagem, com os campos da auditoria repetidos.**
   * Desnormalizar e o que faz o arquivo abrir direto numa planilha; um CSV em
   * duas secoes exige quem o leia saber que ha duas secoes.
   *
   * ---
   *
   * **Nao consome cota, e nao exige direito de plano.**
   *
   * O `GET /leads/export` exige `export.csv` porque exportar a base inteira e
   * uma funcionalidade do plano. Aqui e outra coisa: e levar embora **uma**
   * auditoria que o cliente ja pagou e cujo prazo nos definimos. Cobrar plano
   * para isso seria cobrar pelo direito de nao perder o que ja e dele.
   *
   * A D6 nao pediu porta nenhuma, e **acrescentar restricao que ninguem pediu e
   * pior do que omitir uma que se pode acrescentar depois** — a primeira quebra
   * quem ja usava, a segunda nao quebra ninguem.
   *
   * **Fica liberado sob suspensao, e sem precisar de nada.** O `TenantGuard`
   * decide por metodo HTTP: `GET` passa, salvo se marcado `@ConsomeRecurso()`.
   * Nao marcar e o que basta — e e o comportamento que a §10.4 pede.
   *
   * ---
   *
   * **Dois blocos, com a montagem entre eles**, como no `leads.exportCsv`: nao
   * segurar conexao durante trabalho de CPU que nao e consulta.
   */
  async exportarCsv(
    tenantId: string,
    auditId: string,
    userId: string,
  ): Promise<{ filename: string; content: string; rows: number }> {
    const a = await this.prisma.comTenant(tenantId, (tx) =>
      tx.digitalPresenceAudit.findUnique({
        where: { tenantId_id: { tenantId, id: auditId } },
        include: { checks: { orderBy: { createdAt: 'asc' } } },
      }),
    );

    // Mesma resposta do `detalhe`: auditoria de outro tenant e auditoria
    // inexistente sao indistinguiveis de fora, de proposito.
    if (a === null) throw new NotFoundException('Auditoria não encontrada');

    const cabecalho = [
      'Auditoria',
      'Lead',
      'Situação',
      'Versão',
      'Provedor',
      'Concluída em',
      'Checagem',
      'Resultado',
      'URL observada',
      'Observado em',
      'Código de erro',
      'Confiança',
      'Detalhe',
      'Disponível até',
    ];

    const comuns = [
      a.id,
      a.leadId,
      a.status,
      a.auditVersion,
      a.providerName ?? '',
      a.finishedAt?.toISOString() ?? '',
    ];

    const linhas = a.checks.map((c) => [
      ...comuns,
      c.check,
      c.outcome,
      c.observedUrl ?? '',
      c.observedAt?.toISOString() ?? '',
      c.errorCode ?? '',
      c.confidence === null ? '' : String(c.confidence),
      c.result === null ? '' : JSON.stringify(c.result),
      c.retentionUntil?.toISOString() ?? '',
    ]);

    const conteudo = montarCsv(cabecalho, linhas);

    await this.prisma.comTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'audit.exported',
          entityType: 'DigitalPresenceAudit',
          entityId: a.id,
          after: { rows: a.checks.length } as unknown as object,
        },
      }),
    );

    return {
      filename: `auditoria-${a.id}.csv`,
      content: conteudo,
      rows: a.checks.length,
    };
  }
}
