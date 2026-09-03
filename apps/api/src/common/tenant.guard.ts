import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role, roleAtLeast } from '@propectai/types';

import { PrismaSistemaService } from '../prisma/prisma-sistema.service';
import { CONSOME_RECURSO_KEY, IS_PUBLIC_KEY, REQUIRED_ROLE_KEY } from './decorators';
import type { RequestWithContext } from './request-context';

/**
 * Resolve e valida o tenant ativo.
 *
 * Regra inegociável: o tenantId NUNCA é lido do corpo da requisição.
 * Ele vem do header x-tenant-id ou do membership padrão do usuário, e em
 * ambos os casos o membership é verificado no banco a cada requisição.
 *
 * ---------------------------------------------------------------------------
 * Por que este guard usa o papel que atravessa tenants
 * ---------------------------------------------------------------------------
 *
 * A consulta abaixo tem **dois ramos, de naturezas diferentes**, e é a
 * diferença entre eles que decide o desenho:
 *
 * - **Com `x-tenant-id`**, ele valida. Esse ramo até sobreviveria a uma
 *   política em `memberships`: bastaria declarar o tenant do cabeçalho como
 *   contexto, e a autorização continuaria vindo do filtro por `userId`.
 * - **Sem cabeçalho**, ele *escolhe* — o membership padrão da pessoa, varrendo
 *   todos os workspaces dela. Aqui não há tenant a declarar, porque
 *   descobri-lo é o serviço.
 *
 * Fazer o guard depender dessa distinção seria pior que qualquer um dos dois:
 * a correção dele passaria a variar conforme o cliente mandou ou não um
 * cabeçalho. Então os dois ramos usam o mesmo caminho.
 *
 * **O que não muda:** a autorização nunca esteve na política de RLS, e continua
 * não estando. Quem decide é o `where` por `userId` — o `request.user.id` vem
 * do JWT já validado pelo `JwtAuthGuard`, nunca do corpo nem do cabeçalho. O
 * papel do sistema remove a política do caminho de uma consulta que a política
 * nunca protegeu; ele não afrouxa nenhuma verificação que existisse.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly sistema: PrismaSistemaService,
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

    const usuarioId = request.user.id;

    const membership = await this.sistema.atravessandoTenants(
      'resolver o workspace ativo: sem cabecalho, escolhe o membership padrao da pessoa entre todos os workspaces dela',
      (db) =>
        db.membership.findFirst({
          where: {
            userId: usuarioId,
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
        }),
    );

    // 404 seria mais informativo, mas confirmar a existência do recurso já é
    // vazamento. Membership ausente e tenant inexistente respondem igual.
    if (!membership) {
      throw new ForbiddenException('Sem acesso a este workspace');
    }

    const suspenso = Boolean(membership.tenant.suspendedAt);

    if (suspenso && this.bloqueiaSuspenso(context)) {
      // Mensagem específica de propósito: quem foi suspenso precisa saber o
      // motivo para resolver, não descobrir sozinho.
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
      // Sem cast desde o passo 4 do §11.1: `ActiveTenant.planCode` é `string`,
      // que é o que `Plan.code` sempre foi no banco desde 13/08/2026.
      planCode: membership.tenant.subscription?.plan.code ?? 'FREE',
      country: membership.tenant.country,
      currency: membership.tenant.currency,
      suspended: suspenso,
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

  /**
   * O que a suspensão bloqueia.
   *
   * Decisão em `docs/strategic/lacunas-estruturais.md` §10.4: suspenso **perde
   * o que gasta e mantém o que é dele**. Os leads foram coletados com cota já
   * paga, e reter dado do cliente como alavanca de cobrança colide com o
   * direito de portabilidade (LGPD art. 18, GDPR art. 20) além de ser hostil.
   *
   * A regra é o método HTTP, e não uma lista de rotas permitidas. Lista de
   * rotas envelhece em silêncio: alguém cria um endpoint novo, esquece de
   * incluir, e a suspensão fica mais dura do que se decidiu sem ninguém notar.
   * O método já separa ler de escrever em todo o produto.
   *
   * `@ConsomeRecurso()` cobre o furo do outro lado — as leituras que gastam.
   *
   * Nota sobre a exportação: ela é `GET /leads/export` e continua liberada de
   * propósito. É a rota que materializa a portabilidade, e bloqueá-la seria
   * exatamente a alavanca que a decisão recusa.
   */
  private bloqueiaSuspenso(context: ExecutionContext): boolean {
    const consome = this.reflector.getAllAndOverride<boolean>(CONSOME_RECURSO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (consome) return true;

    const metodo = context.switchToHttp().getRequest<RequestWithContext>().method;

    return metodo !== 'GET' && metodo !== 'HEAD' && metodo !== 'OPTIONS';
  }
}
