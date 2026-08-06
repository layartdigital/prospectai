import type { PlanCode, Role } from './common';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  role: Role;
  planCode: PlanCode;
}

export interface SessionResponse {
  user: AuthUser;
  tenant: AuthTenant | null;
  tenants: AuthTenant[];
  onboardingCompleted: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  tenantName: string;
}

/** Nomes dos cookies. Ambos HttpOnly - nunca legíveis por JavaScript. */
export const AUTH_COOKIES = {
  access: 'pa_at',
  refresh: 'pa_rt',
} as const;

/**
 * Limites por plano. Lidos exclusivamente pelo EntitlementService -
 * nenhum componente ou controller consulta limite diretamente.
 */
export interface PlanLimits {
  leadsIncluded: number;
  searchesPerMonth: number;
  aiGenerationsPerMonth: number;
  maxUsers: number;
  exportFormats: string[];
  retentionDays: number;
  /** Telefone parcialmente oculto na interface. */
  maskPhones: boolean;
  pipelineEnabled: boolean;
}

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  FREE: {
    leadsIncluded: 5,
    searchesPerMonth: 3,
    aiGenerationsPerMonth: 0,
    maxUsers: 1,
    exportFormats: [],
    retentionDays: 30,
    maskPhones: true,
    pipelineEnabled: false,
  },
  START: {
    leadsIncluded: 150,
    searchesPerMonth: 30,
    aiGenerationsPerMonth: 50,
    maxUsers: 1,
    exportFormats: ['csv'],
    retentionDays: 180,
    maskPhones: false,
    pipelineEnabled: true,
  },
  PRO: {
    leadsIncluded: 500,
    searchesPerMonth: 100,
    aiGenerationsPerMonth: 300,
    maxUsers: 5,
    exportFormats: ['csv', 'xlsx'],
    retentionDays: 365,
    maskPhones: false,
    pipelineEnabled: true,
  },
  AGENCY: {
    leadsIncluded: 3000,
    searchesPerMonth: 500,
    aiGenerationsPerMonth: 2000,
    maxUsers: 25,
    exportFormats: ['csv', 'xlsx'],
    retentionDays: 730,
    maskPhones: false,
    pipelineEnabled: true,
  },
};

/** Hierarquia de papéis: índice menor significa mais privilégio. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  SDR: 3,
  VIEWER: 4,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] <= ROLE_RANK[required];
}
