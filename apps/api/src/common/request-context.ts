import type { PlanCode, Role } from '@propectai/types';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface ActiveTenant {
  id: string;
  slug: string;
  role: Role;
  planCode: PlanCode;
  /** ISO 3166-1 alpha-2. Decide locale da taxonomia e regra de normalização. */
  country: string;
  /** ISO 4217. */
  currency: string;
}

/**
 * Request enriquecida pelos guards.
 *
 * `tenant` só existe depois do TenantGuard, e o TenantGuard só o preenche
 * após validar o Membership. O tenantId enviado no corpo da requisição
 * nunca é lido.
 */
export interface RequestWithContext extends Request {
  user?: AuthenticatedUser;
  tenant?: ActiveTenant;
}

export interface JwtPayload {
  sub: string;
  email: string;
  /** Tenant sugerido pela sessão. Ainda assim revalidado a cada requisição. */
  tid?: string;
}
