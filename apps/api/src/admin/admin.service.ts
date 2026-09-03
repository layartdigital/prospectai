import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type AdminTenantList, type AdminTenantView } from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaSistemaService } from '../prisma/prisma-sistema.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Painel do provedor.
 *
 * ---------------------------------------------------------------------------
 * Um dos quatro métodos atravessa tenants. Os outros três não.
 * ---------------------------------------------------------------------------
 *
 * O `PLANO-RLS-PASSO6-v1.md` classificou este arquivo inteiro como "atravessa
 * tenants de propósito", e a classificação está certa sobre o arquivo e errada
 * sobre a granularidade. Lendo método a método:
 *
 * - **`listTenants` atravessa mesmo.** Ele agrega `plan_usages` e
 *   `lead_activities` — as duas com `tenantId` — de **todos** os tenants ao
 *   mesmo tempo. Não há um tenant a declarar porque a resposta é sobre o
 *   conjunto. Este usa o papel do sistema.
 *
 * - **`changePlan`, `suspend` e `reactivate` recebem o `tenantId` por
 *   parâmetro.** Eles agem sobre **um** workspace, e o id chega pronto na
 *   chamada. Não há nada a descobrir.
 *
 * E para esses três o `comTenant` não é apenas suficiente — **é mais
 * apertado**. Sob a política, um defeito que calculasse o tenant errado seria
 * recusado pelo `WITH CHECK` na hora da escrita. Com `BYPASSRLS` o mesmo
 * defeito grava em silêncio no workspace de outro cliente.
 *
 * Escolher o papel mais forte "porque é o painel administrativo" seria confundir
 * quem chama com o que a chamada faz. O operador ser da plataforma decide se ele
 * **pode** agir — isso é o `PlatformAdminGuard`. Não decide sobre **quantos**
 * workspaces a consulta age, que é o que a política governa.
 *
 * A autorização, nos quatro, nunca esteve na política de RLS: está na guarda,
 * que exige registro em `PlatformAdmin`. Nada aqui a afrouxa.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Lista todos os tenants da plataforma.
   *
   * Sem filtro de tenant, de propósito — é o único lugar do sistema onde isso
   * é correto. Toda outra consulta do produto passa por `tenantId`, e esta
   * ausência é a razão pela qual a rota vive atrás de guarda separada.
   *
   * **É o único método deste arquivo que precisa do papel do sistema**, e o
   * motivo está nas duas agregações: `plan_usages` e `lead_activities` têm
   * `tenantId`, e sob política qualquer contexto declarado reduziria a resposta
   * a um workspace só — que é o oposto do que a tela existe para mostrar.
   */
  async listTenants(): Promise<AdminTenantList> {
    const periodStart = inicioDoPeriodo();

    const { tenants, usos, ultimasAtividades, planos } =
      await this.sistema.atravessandoTenants(
        'painel do provedor: agrega consumo e atividade de TODOS os tenants ao mesmo tempo',
        async (db) => {
          const tenants = await db.tenant.findMany({
            where: { deletedAt: null },
            include: {
              subscription: { include: { plan: true } },
              _count: { select: { memberships: true } },
            },
            orderBy: { createdAt: 'desc' },
          });

          const ids = tenants.map((t) => t.id);

          const [usos, ultimasAtividades] = await Promise.all([
            db.planUsage.findMany({ where: { periodStart, tenantId: { in: ids } } }),
            db.leadActivity.groupBy({
              by: ['tenantId'],
              _max: { createdAt: true },
              where: { tenantId: { in: ids } },
            }),
          ]);

          // Os planos vêm do banco, não de lista fixa.
          //
          // Enquanto ninguém conseguia criar plano, a lista compilada não
          // escondia nada. Depois da tela do Master, esconderia: um plano novo
          // teria zero tenants na estatística até alguém lembrar de editar este
          // arquivo — e a estatística estaria errada sem dar sinal.
          //
          // Inclui plano inativo com contagem zero de propósito: sumir da
          // tabela e ter zero são coisas diferentes, e só a segunda é
          // informação.
          const planos = await db.plan.findMany({
            select: { code: true },
            orderBy: { sortOrder: 'asc' },
          });

          return { tenants, usos, ultimasAtividades, planos };
        },
      );

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
   *
   * Sob `comTenant`, e não sob o papel do sistema: o `tenantId` vem por
   * parâmetro, e a política passa a recusar a assinatura gravada no workspace
   * errado em vez de aceitá-la em silêncio.
   */
  async changePlan(
    tenantId: string,
    operadorId: string,
    input: { planCode: string; reason: string },
  ): Promise<void> {
    await this.prisma.comTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
        include: { subscription: { include: { plan: true } } },
      });
      if (!tenant) throw new NotFoundException('Tenant não encontrado');

      const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw new BadRequestException('Plano inexistente');

      const anterior = tenant.subscription?.plan.code ?? null;

      await tx.subscription.upsert({
        where: { tenantId },
        create: { tenantId, planId: plan.id, status: 'ACTIVE' },
        update: { planId: plan.id, status: 'ACTIVE' },
      });

      await tx.auditLog.create({
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
    });
  }

  /**
   * Suspende o acesso sem apagar nada.
   *
   * Diferente de exclusão: os dados permanecem, e reativar devolve tudo. O
   * bloqueio efetivo acontece no `TenantGuard`, não aqui — suspensão que só
   * grava data é anotação, e o inadimplente continua usando o produto.
   *
   * **As quatro escritas num bloco só.** Eram soltas, e a ordem importava:
   * marcar a suspensão e falhar antes de revogar as sessões deixava o
   * workspace suspenso com todo mundo ainda trabalhando lá dentro, até o
   * access token expirar. Agora ou tudo acontece, ou nada.
   */
  async suspend(
    tenantId: string,
    operadorId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.comTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
      });
      if (!tenant) throw new NotFoundException('Tenant não encontrado');
      if (tenant.suspendedAt) throw new BadRequestException('Já está suspenso');

      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: new Date(), suspendedReason: reason },
      });

      // As sessões abertas morrem junto. Sem isto, quem já estava dentro
      // continua trabalhando até o access token expirar.
      //
      // `refresh_tokens` não tem `tenantId` — a sessão é da pessoa, não do
      // workspace —, então nenhuma política a filtra. O recorte vem do
      // `membership.findMany` acima, que é escopado e **está** sob a política.
      const membros = await tx.membership.findMany({
        where: { tenantId, deletedAt: null },
        select: { userId: true },
      });

      await tx.refreshToken.updateMany({
        where: { userId: { in: membros.map((m) => m.userId) }, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: operadorId,
          action: 'admin.tenant_suspended',
          entityType: 'Tenant',
          entityId: tenantId,
          after: { reason },
        },
      });
    });
  }

  async reactivate(tenantId: string, operadorId: string): Promise<void> {
    await this.prisma.comTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
      });
      if (!tenant) throw new NotFoundException('Tenant não encontrado');
      if (!tenant.suspendedAt) throw new BadRequestException('Não está suspenso');

      await tx.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: null, suspendedReason: null },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: operadorId,
          action: 'admin.tenant_reactivated',
          entityType: 'Tenant',
          entityId: tenantId,
          before: { reason: tenant.suspendedReason },
        },
      });
    });
  }
}

/** Mesma definição de período usada pelo motor de cota. */
function inicioDoPeriodo(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
