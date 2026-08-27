import type { AuditStatusName } from '@propectai/types';

/**
 * As decisoes do job de auditoria, separadas do Prisma.
 *
 * Nao e separacao por gosto de arquitetura. O que mora aqui e a defesa contra
 * job forjado e contra replay — a parte com consequencia de seguranca —, e ela
 * precisa ser provavel sem subir banco. O `process-audit-job.ts` fica sendo
 * orquestracao: ler, chamar isto, gravar.
 */

export type MotivoRecusaJob = 'JOB_ALHEIO' | 'CANCELADA' | 'JA_FINALIZADA';

export type DecisaoExecucao =
  | { executar: true; reivindicar: boolean }
  | { executar: false; motivo: MotivoRecusaJob };

export interface EstadoAuditoria {
  readonly status: AuditStatusName;
  readonly queueJobId: string | null;
}

/** Estados dos quais nao se volta. Reexecutar sobre eles e replay. */
const TERMINAIS: ReadonlySet<AuditStatusName> = new Set<AuditStatusName>([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
]);

/**
 * Decide se esta mensagem pode executar esta auditoria.
 *
 * O `queueJobId` e o que separa retry legitimo de mensagem forjada, como o
 * comentario do schema ja dizia: **o retry carrega o mesmo id; a forjada nao.**
 * A primeira execucao reivindica o id; da segunda em diante ele tem de bater.
 *
 * A ordem das recusas e o desenho. `JOB_ALHEIO` vem primeiro porque e o unico
 * evento de seguranca dos tres — os outros dois sao operacao normal. Auditoria
 * ja finalizada recebendo mensagem com id alheio precisa aparecer no log como
 * tentativa de injecao, nao como replay banal.
 *
 * **O retry do BullMQ nao pode morrer aqui.** Com `attempts: 3`, a segunda
 * tentativa chega com a auditoria em `RUNNING` e o mesmo `queueJobId`. Tratar
 * `RUNNING` como terminal mataria a repeticao — e a repeticao existe justamente
 * porque a rede falha. Por isso `RUNNING` nao esta em `TERMINAIS`, e por isso o
 * job so grava `FAILED` na ultima tentativa.
 */
export function decidirExecucao(atual: EstadoAuditoria, queueJobId: string): DecisaoExecucao {
  if (atual.queueJobId !== null && atual.queueJobId !== queueJobId) {
    return { executar: false, motivo: 'JOB_ALHEIO' };
  }
  if (atual.status === 'CANCELLED') {
    return { executar: false, motivo: 'CANCELADA' };
  }
  if (TERMINAIS.has(atual.status)) {
    return { executar: false, motivo: 'JA_FINALIZADA' };
  }
  return { executar: true, reivindicar: atual.queueJobId === null };
}

export type Desfecho =
  | { repetir: true }
  | { repetir: false; persistir: AuditStatusName; devolverCota: boolean };

/**
 * O que fazer com o resultado do provider.
 *
 * `COMPLETED` e `PARTIAL` sao entrega — inclusive quando **todas** as checagens
 * reprovaram, porque site que reprova em tudo e a medicao, nao a falta dela.
 *
 * Falha nossa e diferente: enquanto houver tentativa sobrando, o job levanta o
 * erro e deixa o BullMQ repetir, sem gravar estado terminal. So na ultima e que
 * `FAILED` e persistido — e ai a cota volta, porque o cliente nao paga por
 * auditoria que nao entregou.
 */
export function decidirDesfecho(
  statusDoProvider: AuditStatusName | 'ERRO',
  ultimaTentativa: boolean,
): Desfecho {
  if (statusDoProvider === 'COMPLETED' || statusDoProvider === 'PARTIAL') {
    return { repetir: false, persistir: statusDoProvider, devolverCota: false };
  }
  if (!ultimaTentativa) return { repetir: true };
  return { repetir: false, persistir: 'FAILED', devolverCota: true };
}

/**
 * Prazo de guarda das medicoes.
 *
 * **Numero provisorio, e precisa de decisao do produto.** 180 dias cobrem o
 * ciclo comercial mais folga, de modo que um relatorio entregue ao prospect
 * continue explicavel enquanto a conversa durar. O que nao e provisorio e a
 * existencia do prazo: sem ele a tabela cresce sem limite, que e exatamente o
 * defeito que o `LeadSourceRecord.payload` ja tem e que este modelo existe para
 * nao repetir.
 */
export const RETENCAO_CHECK_DIAS = 180;

export function retencaoAte(agora: Date): Date {
  return new Date(agora.getTime() + RETENCAO_CHECK_DIAS * 24 * 60 * 60 * 1000);
}
