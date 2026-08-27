
/** Um tenant visto pelo provedor. */
export interface AdminTenantView {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  customerType: 'PF' | 'PJ';
  taxId: string | null;
  planCode: string;
  subscriptionStatus: string | null;
  isDemo: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;

  members: number;
  /** Última atividade registrada em qualquer lead do tenant. */
  lastActivityAt: string | null;

  usage: {
    leadsUsed: number;
    leadsIncluded: number;
    aiGenerationsUsed: number;
    aiGenerationsIncluded: number;
    searchesCount: number;
    exportsCount: number;
  };
}

export interface AdminTenantList {
  items: AdminTenantView[];
  total: number;
  /** Contagens do conjunto inteiro, não da página. */
  summary: {
    active: number;
    suspended: number;
    demo: number;
    byPlan: Record<string, number>;
  };
}

export interface ChangePlanInput {
  planCode: string;
  /** Registrado no AuditLog. Trocar plano sem motivo vira mistério em auditoria. */
  reason: string;
}

export interface SuspendTenantInput {
  reason: string;
}
