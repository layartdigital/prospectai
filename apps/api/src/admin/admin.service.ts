import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AdminTenantList, type AdminTenantView } from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Lista todos os tenants da plataforma.
   *
   * Sem filtro de tenant, de propósito — é o único lugar do sistema onde isso
   * é correto. Toda outra consulta do produto passa por `tenantId`, e esta
   * ausência é a razão pela qual a rota vive atrás de guarda separada.
   */
  async listTenants(): Promise<AdminTenantList> {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const periodStart = inicioDoPeriodo();

    const [usos, ultimasAtividades] = await Promise.all([
      this.prisma.planUsage.findMany({
        where: { periodStart, tenantId: { in: tenants.map((t) => t.id) } },
      }),
      this.prisma.leadActivity.groupBy({
        by: ['tenantId'],
        _max: { createdAt: true },
        where: { tenantId: { in: tenants.map((t) => t.id) } },
      }),
    ]);

    const usoPorTenant = new Map(usos.map((uso) => [uso.tenantId, uso]));
    const atividadePorTenant = new Map(
      ultimasAtividades.map((linha) => [linha.tenantId, linha._max.createdAt]),
    );

    const items: AdminTenantView[] = tenants.map((tenant) => {
      const planCode = tenant.subscription?.plan.code ?? 'FREE';
      const limits = this.entitlements.limits(planCode);
      const uso = usoPorTenant.get(tenant.id);

      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        country: tenant.country,
        currency: tenant.currency,
        customerType: tenant.customerType,
        taxId: tenant.taxId,
        planCode,
        subscriptionStatus: tenant.subscription?.status ?? null,
        isDemo: tenant.isDemo,
        suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
        suspendedReason: tenant.suspendedReason,
        createdAt: tenant.createdAt.toISOString(),
        members: tenant._count.memberships,
        lastActivityAt: atividadePorTenant.get(tenant.id)?.toISOString() ?? null,
        usage: {
          leadsUsed: (uso?.leadsReserved ?? 0) + (uso?.leadsSettled ?? 0),
          leadsIncluded: limits.leadsIncluded,
          aiGenerationsUsed: uso?.aiGenerationsCount ?? 0,
          aiGenerationsIncluded: limits.aiGenerationsPerMonth,
          searchesCount: uso?.searchesCount ?? 0,
          exportsCount: uso?.exportsCount ?? 0,
        },
      };
    });

    // Os planos vêm do banco, não de lista fixa.
    //
    // Enquanto ninguém conseguia criar plano, a lista compilada não escondia
    // nada. Depois da tela do Master, esconderia: um plano novo teria zero
    // tenants na estatística até alguém lembrar de editar este arquivo — e a
    // estatística estaria errada sem dar sinal.
    //
    // Inclui plano inativo com contagem zero de propósito: sumir da tabela e
    // ter zero são coisas diferentes, e só a segunda é informação.
    const planos = await this.prisma.plan.findMany({
      select: { code: true },
      orderBy: { sortOrder: 'asc' },
    });

    const byPlan: Record<string, number> = Object.fromEntries(
      planos.map(({ code }) => [code, items.filter((t) => t.planCode === code).length]),
    );

    return {
      items,
      total: items.length,
      summary: {
        active: items.filter((t) => !t.suspendedAt && !t.isDemo).length,
        suspended: items.filter((t) => t.suspendedAt).length,
        demo: items.filter((t) => t.isDemo).length,
        byPlan,
      },
    };
  }

  /**
   * Troca o plano de um tenant.
   *
   * Substitui o `pnpm db:plan`, que por desenho só age em tenant de
   * demonstração — até aqui, não existia nem o caminho manual para um cliente
   * real.
   *
   * O motivo é obrigatório: troca de plano sem justificativa vira mistério em
   * auditoria seis meses depois, quando alguém perguntar por que este cliente
   * está no plano em que está.
   */
  async changePlan(
    tenantId: string,
    operadorId: string,
    input: { planCode: string; reason: string },
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { subscription: { include: { plan: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');

    const plan = await this.prisma.plan.findUnique({
      where: { code: input.planCode },
    });
    if (!plan) throw new BadRequestException('Plano inexistente');

    const anterior = tenant.subscription?.plan.code ?? null;

    await this.prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, planId: plan.id, status: 'ACTIVE' },
      update: { planId: plan.id, status: 'ACTIVE' },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: operadorId,
        action: 'admin.plan_changed',
        entityType: 'Subscription',
        entityId: tenantId,
        before: { planCode: anterior },
        after: { planCode: input.planCode, reason: input.reason },
      },
    });
  }

  /**
   * Suspende o acesso sem apagar nada.
   *
   * Diferente de exclusão: os dados permanecem, e reativar devolve tudo. O
   * bloqueio efetivo acontece no `TenantGuard`, não aqui — suspensão que só
   * grava data é anotação, e o inadimplente continua usando o produto.
   */
  async suspend(
    tenantId: string,
    operadorId: string,
    reason: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    if (tenant.suspendedAt) throw new BadRequestException('Já está suspenso');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: new Date(), suspendedReason: reason },
    });

    // As sessões abertas morrem junto. Sem isto, quem já estava dentro
    // continua trabalhando até o access token expirar.
    const membros = await this.prisma.membership.findMany({
      where: { tenantId, deletedAt: null },
      select: { userId: true },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: { in: membros.map((m) => m.userId) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: operadorId,
        action: 'admin.tenant_suspended',
        entityType: 'Tenant',
        entityId: tenantId,
        after: { reason },
      },
    });
  }

  async reactivate(tenantId: string, operadorId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    if (!tenant.suspendedAt) throw new BadRequestException('Não está suspenso');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: null, suspendedReason: null },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: operadorId,
        action: 'admin.tenant_reactivated',
        entityType: 'Tenant',
        entityId: tenantId,
        before: { reason: tenant.suspendedReason },
      },
    });
  }
}

/** Mesma definição de período usada pelo motor de cota. */
function inicioDoPeriodo(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
