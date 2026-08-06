import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@propectai/types';

import type { ActiveTenant, AuthenticatedUser, RequestWithContext } from './request-context';

export const IS_PUBLIC_KEY = 'propectai:isPublic';
export const REQUIRED_ROLE_KEY = 'propectai:requiredRole';

/** Marca a rota como acessível sem autenticação. Use com parcimônia. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Papel mínimo exigido. A hierarquia é OWNER > ADMIN > MANAGER > SDR > VIEWER,
 * então `@MinRole('MANAGER')` também aceita ADMIN e OWNER.
 */
export const MinRole = (role: Role): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLE_KEY, role);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!request.user) {
      throw new Error('CurrentUser usado em rota sem JwtAuthGuard');
    }
    return request.user;
  },
);

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveTenant => {
    const request = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!request.tenant) {
      throw new Error('CurrentTenant usado em rota sem TenantGuard');
    }
    return request.tenant;
  },
);
