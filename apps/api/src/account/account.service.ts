import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  computeScore,
  type PlanCardView,
  type PlanLimits,
  type PreferencesView,
  type ScoreInput,
  type SubscriptionResponse,
  type UpdatePreferencesInput,
  type WebsiteStatus,
  type WhatsAppStatus,
} from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async subscription(
    tenantId: string,
    planCode: string,
  ): Promise<SubscriptionResponse> {
    const [subscription, plans, usage] = await Promise.all([
      this.prisma.comTenant(tenantId, (tx) =>
        tx.subscription.findUnique({ where: { tenantId } }),
      ),
      // `plans` é catálogo global: não tem `tenantId` e nunca terá política.
      this.prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.entitlements.currentUsage(tenantId),
    ]);

    const limits = this.entitlements.limits(planCode);

    return {
      currentPlan: planCode,
      status: subscription?.status ?? 'TRIALING',
      usage: {
        leadsUsed: usage.leadsReserved + usage.leadsSettled,
        leadsIncluded: limits.leadsIncluded,
        aiGenerationsUsed: usage.aiGenerationsCount,
        aiGenerationsIncluded: limits.aiGenerationsPerMonth,
        searchesCount: usage.searchesCount,
        periodStart: usage.periodStart.toISOString(),
        periodEnd: usage.periodEnd.toISOString(),
      },
      plans: plans.map<PlanCardView>((plan) => ({
        code: plan.code,
        name: plan.name,
        priceCents: plan.priceCents,
        currency: plan.currency,
        // Sem fallback para constante compilada. `limits` é coluna obrigatória
        // — se estiver vazia, o plano está mal cadastrado e a tela precisa
        // mostrar isso, não disfarçar com um valor que ninguém configurou.
        limits: plan.limits as unknown as PlanLimits,
        isCurrent: plan.code === planCode,
        sortOrder: plan.sortOrder,
      })),
    };
  }

  async preferences(tenantId: string): Promise<PreferencesView> {
    return this.prisma.comTenant(tenantId, (tx) => this.lerPreferencias(tx, tenantId));
  }

  /**
   * O corpo do `preferences`, recebendo o `tx`.
   *
   * **Seis métodos deste arquivo terminam devolvendo as preferências**, e todos
   * chamavam `this.preferences()`. Se ele abrisse o próprio bloco, cada um
   * desses métodos abriria transação dentro de transação, segurando duas
   * conexões. Com a versão que recebe o `tx`, o método público embrulha uma vez
   * e os internos reaproveitam o bloco que já está aberto.
   *
   * Mesmo conserto do `assertNaoEUltimoDono` no `TeamService`, e o mesmo que o
   * `EntitlementsService` vai precisar.
   */
  private async lerPreferencias(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<PreferencesView> {
    const [state, tenant] = await Promise.all([
      tx.onboardingState.upsert({
        where: { tenantId },
        create: { tenantId },
        update: {},
      }),
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          segment: { select: { id: true, name: true, macroSegment: true } },
        },
      }),
    ]);

    return {
      servicesSold: (state.servicesSold as string[] | null) ?? [],
      targetNiches: (state.targetNiches as string[] | null) ?? [],
      targetRegions: (state.targetRegions as string[] | null) ?? [],
      preferredChannel: state.preferredChannel,
      monthlyGoal: state.monthlyGoal,
      completedAt: state.completedAt?.toISOString() ?? null,
      segment: tenant?.segment ?? null,
    };
  }

  /**
   * Define o segmento de atuação do tenant e aplica os padrões.
   *
   * `aplicarPadroes` é escolha de quem clica, não automatismo: trocar de
   * segmento não pode apagar em silêncio uma lista de nichos que a pessoa
   * ajustou à mão durante meses. Quando pedido, o padrão **soma** ao que já
   * existe em vez de substituir — remover é decisão dela.
   */
  async setSegment(
    tenantId: string,
    userId: string,
    segmentId: string | null,
    aplicarPadroes: boolean,
  ): Promise<PreferencesView> {
    return this.prisma.comTenant(tenantId, async (tx) => {
    const segment = segmentId
      ? await tx.segment.findFirst({
          where: { id: segmentId, isActive: true },
        })
      : null;

    if (segmentId && !segment) {
      throw new NotFoundException('Segmento não encontrado');
    }

    await tx.tenant.update({
      where: { id: tenantId },
      data: { segmentId: segment?.id ?? null },
    });

    if (segment && aplicarPadroes) {
      const atual = await this.lerPreferencias(tx, tenantId);

      const unir = (existente: string[], novo: string[]): string[] =>
        Array.from(new Set([...existente, ...novo]));

      await tx.onboardingState.upsert({
        where: { tenantId },
        create: {
          tenantId,
          servicesSold: segment.services,
          targetNiches: segment.targetSectors,
        },
        update: {
          servicesSold: unir(atual.servicesSold, segment.services),
          targetNiches: unir(atual.targetNiches, segment.targetSectors),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'settings.segment_changed',
        entityType: 'Tenant',
        entityId: tenantId,
        after: { segmentId: segment?.id ?? null, aplicarPadroes },
      },
    });

    return this.lerPreferencias(tx, tenantId);
    });
  }

  /**
   * Conclui o onboarding.
   *
   * Transição explícita, e não efeito colateral de salvar preferência: a pessoa
   * pode ajustar nichos em Configurações mil vezes sem que isso signifique
   * "terminei de me apresentar ao produto". Idempotente — reconcluir mantém a
   * data original, porque a informação útil é quando terminou da primeira vez.
   */
  async completeOnboarding(tenantId: string, userId: string): Promise<PreferencesView> {
    return this.prisma.comTenant(tenantId, async (tx) => {
    const existing = await tx.onboardingState.findUnique({ where: { tenantId } });

    if (!existing?.completedAt) {
      await tx.onboardingState.upsert({
        where: { tenantId },
        create: { tenantId, completedAt: new Date() },
        update: { completedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'onboarding.completed',
          entityType: 'OnboardingState',
          entityId: existing?.id ?? tenantId,
        },
      });
    }

    return this.lerPreferencias(tx, tenantId);
    });
  }

  /**
   * Reinicia o onboarding sem apagar as preferências.
   *
   * Quem refaz quer rever as perguntas, não perder o que já respondeu — as
   * respostas anteriores voltam pré-preenchidas. Zerar as listas também
   * derrubaria dois pesos do score (nicho +15, região +5) por um clique que
   * o usuário entende como "só quero olhar de novo".
   */
  async restartOnboarding(tenantId: string, userId: string): Promise<PreferencesView> {
    return this.prisma.comTenant(tenantId, async (tx) => {
    await tx.onboardingState.upsert({
      where: { tenantId },
      create: { tenantId },
      update: { completedAt: null },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'onboarding.restarted',
        entityType: 'OnboardingState',
        entityId: tenantId,
      },
    });

    return this.lerPreferencias(tx, tenantId);
    });
  }

  /**
   * Salva as preferências e informa se o score ficou defasado.
   *
   * Nicho prioritário vale +15 e região atendida vale +5 — juntos, um quinto
   * do score máximo. Mudar essas listas sem recalcular deixaria a base inteira
   * com pontuação que não corresponde mais ao critério declarado.
   */
  async updatePreferences(
    tenantId: string,
    userId: string,
    input: UpdatePreferencesInput,
  ): Promise<PreferencesView & { scoreAffected: boolean }> {
    return this.prisma.comTenant(tenantId, async (tx) => {
    const before = await this.lerPreferencias(tx, tenantId);

    const state = await tx.onboardingState.upsert({
      where: { tenantId },
      create: {
        tenantId,
        servicesSold: input.servicesSold ?? [],
        targetNiches: input.targetNiches ?? [],
        targetRegions: input.targetRegions ?? [],
        preferredChannel: input.preferredChannel ?? null,
        monthlyGoal: input.monthlyGoal ?? null,
        // completedAt NAO e escrito aqui.
        //
        // Salvar preferencia nao e terminar onboarding. O campo so era
        // preenchido neste ramo `create`, mas `preferences()` ja cria a linha
        // vazia no primeiro GET — entao todo PATCH caia no ramo `update`, onde
        // completedAt nunca era tocado. Resultado: o onboarding jamais podia
        // ser concluido. Corrigido em 31/07/2026 promovendo a conclusao a
        // transicao explicita, em completeOnboarding().
      },
      update: {
        ...(input.servicesSold ? { servicesSold: input.servicesSold } : {}),
        ...(input.targetNiches ? { targetNiches: input.targetNiches } : {}),
        ...(input.targetRegions ? { targetRegions: input.targetRegions } : {}),
        ...(input.preferredChannel !== undefined
          ? { preferredChannel: input.preferredChannel }
          : {}),
        ...(input.monthlyGoal !== undefined ? { monthlyGoal: input.monthlyGoal } : {}),
      },
    });

    const scoreAffected =
      JSON.stringify(before.targetNiches) !== JSON.stringify(input.targetNiches ?? before.targetNiches) ||
      JSON.stringify(before.targetRegions) !== JSON.stringify(input.targetRegions ?? before.targetRegions);

    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'settings.preferences.updated',
        entityType: 'OnboardingState',
        entityId: state.id,
        before: before as unknown as object,
        after: input as unknown as object,
      },
    });

    // Reaproveita `preferences` em vez de montar o objeto de novo.
    //
    // Havia duas construções da mesma view, e a segunda ficou para trás quando
    // `segment` entrou — o typecheck pegou, mas só porque o campo é
    // obrigatório. Campo opcional teria passado, e a tela mostraria "sem
    // segmento" depois de salvar preferências.
    return { ...(await this.lerPreferencias(tx, tenantId)), scoreAffected };
    });
  }

  /**
   * Recalcula o score de toda a base com o mesmo motor do worker e do seed.
   *
   * Ação explícita do usuário: mudar preferências não dispara recálculo
   * silencioso, porque a base pode ter milhares de leads e o resultado muda
   * a ordem de prioridade que a pessoa está usando naquele momento.
   */
  async recalculateAllScores(
    tenantId: string,
    userId: string,
  ): Promise<{ updated: number }> {
    const preferences = await this.preferences(tenantId);
    const niches = preferences.targetNiches.map((niche) => niche.toLowerCase());
    const regions = preferences.targetRegions.map((region) => region.toLowerCase());

    const leads = await this.prisma.comTenant(tenantId, (tx) =>
      tx.lead.findMany({
        where: { tenantId, deletedAt: null },
        include: { digitalPresence: true, score: true },
      }),
    );

    /**
     * **Em lotes, e não num bloco só.**
     *
     * Este laço faz três consultas por lead. Numa base de mil leads são três
     * mil comandos — e uma transação do Prisma os serializa numa conexão só.
     * A ~3 ms cada, isso é meio minuto dentro de um bloco cujo teto é 10 s: o
     * recálculo morreria por timeout justamente nos workspaces grandes, que são
     * os que mais precisam dele.
     *
     * Cem por lote dá cerca de trezentos comandos, ou ~1 s — folga confortável
     * contra o teto, e continua pagando o custo do contexto uma vez a cada cem
     * leads em vez de uma vez por lead.
     *
     * **Não se perde atomicidade**, porque ela não existia: hoje cada lead já é
     * um conjunto de comandos soltos, e um erro no meio deixa metade da base
     * recalculada. Em lotes, o mesmo erro deixa metade — só que com fronteira
     * conhecida.
     */
    const LOTE = 100;

    for (let inicio = 0; inicio < leads.length; inicio += LOTE) {
      const lote = leads.slice(inicio, inicio + LOTE);

      await this.prisma.comTenant(tenantId, async (tx) => {
    for (const lead of lote) {
      const category = (lead.category ?? '').toLowerCase();
      const city = (lead.addressCity ?? '').toLowerCase();

      const input: ScoreInput = {
        websiteStatus: lead.websiteStatus as WebsiteStatus,
        websiteHasHttps: lead.digitalPresence?.websiteHasHttps ?? null,
        hasPhone: Boolean(lead.phoneE164),
        whatsappStatus: (lead.digitalPresence?.whatsappStatus ??
          'UNKNOWN') as WhatsAppStatus,
        email: lead.email,
        reviewCount: lead.reviewCount,
        reviewRating: lead.reviewRating,
        hasOpenHours: Boolean(lead.openHours),
        hasCompleteAddress: Boolean(lead.addressPostalCode),
        isPriorityNiche: niches.some(
          (niche) => category.length > 3 && niche.startsWith(category.slice(0, 6)),
        ),
        isServedRegion: regions.some(
          (region) => city.length > 2 && region.startsWith(city),
        ),
        lastContactedAt: lead.lastContactedAt,
        lastEnrichedAt: lead.lastEnrichedAt,
        isSuppressed: Boolean(lead.suppressedAt),
        isPermanentlyClosed: false,
      };

      const result = computeScore(input);

      const score = await tx.leadScore.upsert({
        where: { leadId: lead.id },
        create: {
          tenantId,
          leadId: lead.id,
          value: result.value,
          level: result.level,
          algorithmVersion: result.algorithmVersion,
        },
        update: {
          value: result.value,
          level: result.level,
          calculatedAt: new Date(),
        },
      });

      await tx.leadScoreReason.deleteMany({ where: { scoreId: score.id } });
      await tx.leadScoreReason.createMany({
        data: result.reasons.map((reason) => ({
          tenantId,
          scoreId: score.id,
          code: reason.code,
          label: reason.label,
          weight: reason.weight,
          polarity: reason.polarity,
          evidence: reason.evidence,
        })),
      });
    }
      });
    }

    await this.prisma.comTenant(tenantId, (tx) =>
      tx.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'settings.scores.recalculated',
        entityType: 'Tenant',
        entityId: tenantId,
        after: { updated: leads.length },
      },
      }),
    );

    return { updated: leads.length };
  }
}
