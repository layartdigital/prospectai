import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@propectai/types';

import type { ActiveTenant, AuthenticatedUser, RequestWithContext } from './request-context';

export const IS_PUBLIC_KEY = 'propectai:isPublic';
export const REQUIRED_ROLE_KEY = 'propectai:requiredRole';
export const CONSOME_RECURSO_KEY = 'propectai:consomeRecurso';

/** Marca a rota como acessível sem autenticação. Use com parcimônia. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Papel mínimo exigido. A hierarquia é OWNER > ADMIN > MANAGER > SDR > VIEWER,
 * então `@MinRole('MANAGER')` também aceita ADMIN e OWNER.
 */
export const MinRole = (role: Role): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLE_KEY, role);

/**
 * Marca a rota como consumidora de recurso pago.
 *
 * Existe para o tenant suspenso. A regra geral usa o método HTTP — suspenso lê
 * e não escreve —, mas isso deixaria passar as leituras que **gastam**: abrir
 * um segmento em idioma novo dispara geração por IA, e é um `GET`.
 *
 * Sem esta marca, um workspace inadimplente continuaria queimando orçamento de
 * IA só navegando. Rota nova que custe dinheiro precisa dela; esquecer é o
 * único jeito de furar a suspensão.
 */
export const ConsomeRecurso = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CONSOME_RECURSO_KEY, true);

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
