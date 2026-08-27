/**
 * Abstracao da auditoria de presenca digital.
 *
 * Quarta aplicacao da mesma convencao de `LeadSourceProvider`, `PaymentProvider`
 * e `AIProvider`: `name` legivel, verbos do dominio, pasta `providers/`, fabrica
 * escolhendo por variavel de ambiente, mock e fallback logado.
 *
 * O motor concreto e nosso — nao ha servico externo a abstrair aqui. A
 * interface existe pelo outro motivo: o ADR-004 Parte 2 pode mover a execucao
 * para outro processo, e a tela de auditoria nao pode saber disso.
 */

/** Espelha o enum `SiteCheck` do Prisma. */
export const SITE_CHECKS = [
  'DNS',
  'HTTP_REACHABLE',
  'HTTPS',
  'REDIRECT_CHAIN',
  'VIEWPORT_META',
  'TTFB',
  'TITLE_META',
] as const;
export type SiteCheckName = (typeof SITE_CHECKS)[number];

/**
 * O que a v1 mede de verdade.
 *
 * Os tres de fora nao sao esquecimento: `VIEWPORT_META` e `TITLE_META` exigem
 * parsear HTML de terceiro — superficie de ataque nova dentro do modulo cujo
 * proposito e conter terceiros — e `TTFB` esbarra num descasamento conhecido,
 * porque o `fetcher` mede o tempo do **primeiro salto**. Para um site que faz
 * `301` de http para https, e o caso comum e nao a excecao, o numero seria o do
 * redirect e nao o da pagina. Medir errado e pior que nao medir: o numero errado
 * vai para o relatorio do cliente com a mesma cara do certo.
 */
export const SITE_CHECKS_V1 = ['DNS', 'HTTP_REACHABLE', 'HTTPS', 'REDIRECT_CHAIN'] as const;
export type SiteCheckV1 = (typeof SITE_CHECKS_V1)[number];

/** Espelha o enum `CheckOutcome` do Prisma. */
export const CHECK_OUTCOMES = ['OK', 'FAILED', 'SKIPPED'] as const;
export type CheckOutcomeName = (typeof CHECK_OUTCOMES)[number];

/** Espelha o enum `AuditStatus` do Prisma. */
export const AUDIT_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;
export type AuditStatusName = (typeof AUDIT_STATUSES)[number];

export const AUDIT_VERSION = 'audit-v1';

/**
 * **`CheckOutcome.FAILED` e `AuditStatus.FAILED` sao coisas diferentes, e
 * confundi-las custa caro.**
 *
 * `CheckOutcome.FAILED` = o site reprovou na checagem. E o produto: "seu dominio
 * nao resolve", "seu certificado expirou". Auditoria que so encontra reprovacao
 * e uma auditoria bem-sucedida.
 *
 * `AuditStatus.FAILED` = nos nao conseguimos medir. E defeito nosso.
 *
 * Sem a distincao, todo site quebrado viraria job com falha — e o BullMQ o
 * repetiria tres vezes para chegar a mesma conclusao correta da primeira vez.
 */
/** O que cabe numa medicao. Escalar, e o `null` do JSON. */
export type MedicaoValor = string | number | boolean | null;

export interface SiteCheckResult {
  readonly check: SiteCheckName;
  readonly outcome: CheckOutcomeName;
  /**
   * URL efetivamente observada, **sem query string**.
   *
   * O corte da query nao e estetico. Site de captura poe dado pessoal ali
   * (`?email=`, `?cpf=`), e o §3 proibe que isso entre no pipeline. Origem e
   * caminho bastam para o achado; o resto e risco sem uso.
   */
  readonly observedUrl: string | null;
  readonly observedAt: string;
  /**
   * A medicao, **plana e escalar**. Nunca conteudo da pagina.
   *
   * `Record<string, unknown>` era o que estava aqui, e o Prisma recusou —
   * corretamente: `unknown` nao e provavelmente serializavel em JSON. O reparo
   * nao foi um cast, foi apertar o tipo, porque a restricao mais estreita
   * documenta algo verdadeiro e util.
   *
   * **Plano e a garantia.** Nenhuma das quatro checagens da v1 precisa de
   * estrutura aninhada — sao contagens, booleanos e um hostname. Objeto
   * aninhado e a forma que trecho de pagina teria se vazasse para ca, e com
   * este tipo ele nao compila. Quem um dia precisar de aninhamento vai ter de
   * mudar esta linha de proposito, e essa e a hora de perguntar o que esta
   * entrando junto.
   */
  readonly result: Readonly<Record<string, MedicaoValor>> | null;
  readonly errorCode: string | null;
  /**
   * Nulo nas quatro checagens da v1, e de proposito.
   *
   * Sao medicoes diretas — o dominio resolve ou nao, o certificado valida ou
   * nao. Inventar `0.95` daria a uma certeza a aparencia de estimativa. O campo
   * existe para as checagens inferenciais que virao.
   */
  readonly confidence: number | null;
}

export interface SiteAuditInput {
  /** `Lead.website` cru, como veio da fonte. Nada aqui assume boa fe. */
  readonly website: string;
  /** Teto para a auditoria inteira, somando todas as sondas. */
  readonly orcamentoMs?: number;
}

export interface SiteAuditResult {
  readonly auditVersion: string;
  readonly status: AuditStatusName;
  readonly checks: SiteCheckResult[];
  readonly durationMs: number;
  /** Preenchido so quando `status` e `FAILED` — ou seja, quando a falha e nossa. */
  readonly errorCode: string | null;
}

export interface SiteAuditProvider {
  readonly name: string;
  auditar(input: SiteAuditInput): Promise<SiteAuditResult>;
}
