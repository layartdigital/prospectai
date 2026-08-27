import type { Prisma, PrismaClient } from '@prisma/client';
import type { SiteAuditProvider, SiteAuditResult } from '@propectai/types';

import { comTenant } from '../db/com-tenant';
import { logger } from '../logger';
import { decidirDesfecho, decidirExecucao, retencaoAte } from './audit-decisoes';

/**
 * Ciclo de uma auditoria de presenca digital.
 *
 *   REQUESTED/QUEUED -> RUNNING -> COMPLETED | PARTIAL | FAILED
 *
 * Regras que nao podem ser quebradas:
 *   - Mensagem com `queueJobId` alheio nao executa (egress policy §4, T6)
 *   - Auditoria ja finalizada nao reexecuta
 *   - Auditoria que nao entregou devolve a cota
 *   - Nenhum byte de pagina e gravado — o provider ja garante, e nada aqui
 *     acrescenta campo que possa carregar conteudo
 *
 * ---
 *
 * **A forma do arquivo e ditada pelo `comTenant`.** O trabalho esta em duas
 * transacoes com a medicao no meio, e nao numa transacao so, porque a medicao e
 * uma conexao com o site do lead que pode levar ate 30 segundos. Uma transacao
 * aberta durante essa espera prenderia uma conexao do pool pelo tempo de uma
 * requisicao HTTP externa — e, com RLS ligado no passo 4, seguraria um snapshot
 * junto.
 *
 *   transacao 1: ler, decidir, reivindicar a fila
 *   ---- fora de transacao: provider.auditar() ----
 *   transacao 2: gravar checagens, finalizar, devolver cota, registrar
 */

export interface AuditJobPayload {
  tenantId: string;
  auditId: string;
}

export interface ContextoFila {
  /** Id do job no BullMQ. E a credencial da mensagem. */
  readonly queueJobId: string;
  readonly ultimaTentativa: boolean;
}

export interface ResultadoJob {
  readonly executou: boolean;
  readonly status: string;
  readonly checks: number;
  readonly motivo?: string;
}

export async function processAuditJob(
  prisma: PrismaClient,
  provider: SiteAuditProvider,
  payload: AuditJobPayload,
  contexto: ContextoFila,
): Promise<ResultadoJob> {
  const { tenantId, auditId } = payload;
  const inicio = Date.now();

  /**
   * Transacao 1 — ler, decidir e reivindicar.
   *
   * As tres viravam consultas soltas. Junta-las nao muda o resultado hoje, mas
   * estreita a janela entre ler o `queueJobId` e grava-lo. Nao a **fecha**:
   * fechar exigiria `SELECT ... FOR UPDATE` ou um `updateMany` condicional, e
   * isso e mudanca de comportamento — nao cabe neste passo.
   */
  const preparo = await comTenant(prisma, tenantId, async (tx) => {
    // **A chave e composta.** Um payload que troque so o `tenantId` nao encontra
    // a auditoria de outro tenant — a busca falha em vez de vazar. E a mesma
    // defesa que as FKs compostas de F0 dao na escrita, aplicada a leitura.
    const auditoria = await tx.digitalPresenceAudit.findUnique({
      where: { tenantId_id: { tenantId, id: auditId } },
      select: { id: true, leadId: true, status: true, queueJobId: true },
    });

    if (auditoria === null) return { tipo: 'inexistente' as const };

    const decisao = decidirExecucao(
      { status: auditoria.status, queueJobId: auditoria.queueJobId },
      contexto.queueJobId,
    );

    if (!decisao.executar) {
      return { tipo: 'recusado' as const, decisao, auditoria };
    }

    const lead = await tx.lead.findUnique({
      where: { tenantId_id: { tenantId, id: auditoria.leadId } },
      select: { website: true },
    });

    await tx.digitalPresenceAudit.update({
      where: { tenantId_id: { tenantId, id: auditId } },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        // Reivindica a fila na primeira execucao. Da segunda em diante o
        // `decidirExecucao` ja conferiu que bate.
        ...(decisao.reivindicar ? { queueJobId: contexto.queueJobId } : {}),
      },
    });

    return { tipo: 'segue' as const, website: lead?.website ?? '' };
  });

  // Os logs ficam fora da transacao de proposito: escrever no stdout nao e
  // trabalho de banco, e um log lento nao tem por que segurar uma conexao.
  if (preparo.tipo === 'inexistente') {
    logger.warn({ tenantId, auditId, queueJobId: contexto.queueJobId }, 'Auditoria inexistente');
    return { executou: false, status: 'INEXISTENTE', checks: 0, motivo: 'INEXISTENTE' };
  }

  if (preparo.tipo === 'recusado') {
    // `JOB_ALHEIO` e o unico dos tres que e evento de seguranca. Sai em `warn`
    // com o id da mensagem e o id gravado, porque a diferenca entre os dois e a
    // prova.
    const nivel = preparo.decisao.motivo === 'JOB_ALHEIO' ? 'warn' : 'debug';
    logger[nivel](
      {
        tenantId,
        auditId,
        motivo: preparo.decisao.motivo,
        queueJobIdRecebido: contexto.queueJobId,
        queueJobIdGravado: preparo.auditoria.queueJobId,
      },
      'Job de auditoria recusado',
    );
    return {
      executou: false,
      status: preparo.auditoria.status,
      checks: 0,
      motivo: preparo.decisao.motivo,
    };
  }

  // ---- Fora de qualquer transacao. Aqui ha rede, DNS e TLS. ----
  let resultado: SiteAuditResult | null = null;
  try {
    resultado = await provider.auditar({ website: preparo.website });
  } catch (erro) {
    logger.error(
      { tenantId, auditId, erro: erro instanceof Error ? erro.message : 'desconhecido' },
      'Provider de auditoria lancou',
    );
  }

  const desfecho = decidirDesfecho(resultado?.status ?? 'ERRO', contexto.ultimaTentativa);

  if (desfecho.repetir) {
    // Sai sem estado terminal, de proposito: o BullMQ repete, e a proxima
    // tentativa passa pelo `decidirExecucao` com o mesmo `queueJobId`.
    throw new Error(`Auditoria ${auditId} falhou; deixando o retry seguir`);
  }

  const agora = new Date();
  const checks = resultado?.checks ?? [];
  // Fechado antes da escrita: o que se quer medir e a auditoria, nao o tempo de
  // gravar o resultado dela.
  const duracaoMs = Date.now() - inicio;

  /**
   * Transacao 2 — o desfecho inteiro, atomico.
   *
   * A cota e o registro de auditoria estavam fora da transacao das checagens.
   * Agora os quatro comandos vivem ou morrem juntos, e some o estado
   * intermediario em que a auditoria constava `COMPLETED` sem `AuditLog`.
   */
  await comTenant(prisma, tenantId, async (tx) => {
    if (checks.length > 0) {
      await tx.digitalPresenceCheck.createMany({
        data: checks.map((c) => ({
          tenantId,
          auditId,
          check: c.check,
          outcome: c.outcome,
          observedUrl: c.observedUrl,
          observedAt: c.observedAt === null ? null : new Date(c.observedAt),
          result: c.result ?? undefined,
          errorCode: c.errorCode,
          confidence: c.confidence,
          retentionUntil: retencaoAte(agora),
        })),
      });
    }

    await tx.digitalPresenceAudit.update({
      where: { tenantId_id: { tenantId, id: auditId } },
      data: {
        status: desfecho.persistir,
        // Quem mediu fica gravado junto com o que foi medido. Ver a nota no
        // schema: sem isto, mock e nativo produzem linhas indistinguiveis.
        providerName: provider.name,
        finishedAt: agora,
        durationMs: duracaoMs,
        errorCode: resultado?.errorCode ?? (resultado === null ? 'PROVIDER_ERRO' : null),
      },
    });

    if (desfecho.devolverCota) {
      await devolverCota(tx, tenantId);
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'audit.presence.finished',
        entityType: 'DigitalPresenceAudit',
        entityId: auditId,
        after: {
          status: desfecho.persistir,
          checks: checks.length,
          durationMs: duracaoMs,
        },
      },
    });
  });

  return { executou: true, status: desfecho.persistir, checks: checks.length };
}

function inicioDoPeriodo(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

/**
 * Auditoria que nao entregou nao consome credito.
 *
 * O gate cobra na tentativa — e onde ele tem de agir, porque cobrar no
 * carregamento da tela puniria quem so abriu o lead. Aqui e o outro lado: o
 * credito volta quando a medicao nao aconteceu.
 *
 * **`updateMany`, e nao `update` com catch.** A versao anterior engolia o erro
 * de "periodo inexistente" com `.catch(() => {})`, o que funcionava porque
 * rodava fora de transacao. Dentro de uma, o mesmo catch seria uma armadilha:
 * o Postgres poe a transacao em estado abortado depois de qualquer erro, e o
 * `COMMIT` seguinte vira `ROLLBACK` **sem lancar** — as checagens e o desfecho
 * sumiriam, em silencio, por causa de um periodo que nem precisava existir.
 * `updateMany` nao estoura: devolve zero.
 */
async function devolverCota(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.planUsage.updateMany({
    where: { tenantId, periodStart: inicioDoPeriodo() },
    data: { auditsCount: { decrement: 1 } },
  });
}
