import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role, roleAtLeast } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY, REQUIRED_ROLE_KEY } from './decorators';
import type { RequestWithContext } from './request-context';

/**
 * Resolve e valida o tenant ativo.
 *
 * Regra inegociável: o tenantId NUNCA é lido do corpo da requisição.
 * Ele vem do header x-tenant-id ou do membership padrão do usuário, e em
 * ambos os casos o membership é verificado no banco a cada requisição.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.user) {
      throw new UnauthorizedException('Sessão não encontrada');
    }

    const requestedTenantId = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(requestedTenantId)
      ? requestedTenantId[0]
      : requestedTenantId;

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: request.user.id,
        deletedAt: null,
        ...(tenantId ? { tenantId } : {}),
        tenant: { deletedAt: null },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        tenant: {
          include: { subscription: { include: { plan: true } } },
        },
      },
    });

    // 404 seria mais informativo, mas confirmar a existência do recurso já é
    // vazamento. Membership ausente e tenant inexistente respondem igual.
    if (!membership) {
      throw new ForbiddenException('Sem acesso a este workspace');
    }

    // Suspensão que não bloqueia é anotação no painel: o inadimplente continua
    // usando o produto. A mensagem é específica de propósito — quem foi
    // suspenso precisa saber o motivo para resolver, não descobrir sozinho.
    if (membership.tenant.suspendedAt) {
      throw new ForbiddenException({
        message:
          membership.tenant.suspendedReason ??
          'Este workspace está suspenso. Entre em contato com o suporte.',
        code: 'TENANT_SUSPENDED',
      });
    }

    request.tenant = {
      id: membership.tenantId,
      slug: membership.tenant.slug,
      role: membership.role as Role,
      planCode: membership.tenant.subscription?.plan.code ?? 'FREE',
      country: membership.tenant.country,
      currency: membership.tenant.currency,
    };

    const requiredRole = this.reflector.getAllAndOverride<Role>(REQUIRED_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRole && !roleAtLeast(request.tenant.role, requiredRole)) {
      throw new ForbiddenException(
        `Esta ação exige papel ${requiredRole} ou superior`,
      );
    }

    return true;
  }
}
