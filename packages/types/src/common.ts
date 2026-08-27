/** Tipos transversais. */

export type Uuid = string;

/** Papeis dentro de um tenant, do mais para o menos privilegiado. */
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SDR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Nao existe tipo `PlanCode`, e a ausencia e a decisao.
 *
 * `Plan.code` e texto unico no banco desde 13/08/2026 — o Master cria plano
 * sem deploy. Uma uniao de quatro literais aqui reintroduziria o enum na
 * camada de tipos e faria o quinto plano nao compilar. Ver
 * `docs/strategic/lacunas-estruturais.md` §11.1, passo 4.
 *
 * Quem precisa da lista de planos consulta o banco.
 */

/**
 * Tres estados, nunca dois.
 *
 * DESCONHECIDO significa "nao verificado" e nao pontua no score.
 * So vira AUSENTE apos verificacao real. Marcar um lead como "sem Instagram"
 * sem nunca ter olhado e falso negativo e destroi a confianca na lista.
 */
export const SIGNAL_STATES = ['PRESENTE', 'AUSENTE', 'DESCONHECIDO'] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** Contexto do tenant resolvido pelo TenantGuard. Nunca vem do body. */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
}
