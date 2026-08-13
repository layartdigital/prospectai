import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PLAN_LIMITS,
  computeScore,
  type PlanCardView,
  type PlanCode,
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
    planCode: PlanCode,
  ): Promise<SubscriptionResponse> {
    const [subscription, plans, usage] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { tenantId } }),
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
        code: plan.code as PlanCode,
        name: plan.name,
        priceCents: plan.priceCents,
        currency: plan.currency,
        limits: (plan.limits as unknown as PlanLimits) ?? PLAN_LIMITS[plan.code as PlanCode],
        isCurrent: plan.code === planCode,
        sortOrder: plan.sortOrder,
      })),
    };
  }

  async preferences(tenantId: string): Promise<PreferencesView> {
    const [state, tenant] = await Promise.all([
      this.prisma.onboardingState.upsert({
        where: { tenantId },
        create: { tenantId },
        update: {},
      }),
      this.prisma.tenant.findUnique({
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
    const segment = segmentId
      ? await this.prisma.segment.findFirst({
          where: { id: segmentId, isActive: true },
        })
      : null;

    if (segmentId && !segment) {
      throw new NotFoundException('Segmento não encontrado');
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { segmentId: segment?.id ?? null },
    });

    if (segment && aplicarPadroes) {
      const atual = await this.preferences(tenantId);

      const unir = (existente: string[], novo: string[]): string[] =>
        Array.from(new Set([...existente, ...novo]));

      await this.prisma.onboardingState.upsert({
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

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'settings.segment_changed',
        entityType: 'Tenant',
        entityId: tenantId,
        after: { segmentId: segment?.id ?? null, aplicarPadroes },
      },
    });

    return this.preferences(tenantId);
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
    const existing = await this.prisma.onboardingState.findUnique({ where: { tenantId } });

    if (!existing?.completedAt) {
      await this.prisma.onboardingState.upsert({
        where: { tenantId },
        create: { tenantId, completedAt: new Date() },
        update: { completedAt: new Date() },
      });

      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'onboarding.completed',
          entityType: 'OnboardingState',
          entityId: existing?.id ?? tenantId,
        },
      });
    }

    return this.preferences(tenantId);
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
    await this.prisma.onboardingState.upsert({
      where: { tenantId },
      create: { tenantId },
      update: { completedAt: null },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'onboarding.restarted',
        entityType: 'OnboardingState',
        entityId: tenantId,
      },
    });

    return this.preferences(tenantId);
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
    const before = await this.preferences(tenantId);

    const state = await this.prisma.onboardingState.upsert({
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

    await this.prisma.auditLog.create({
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
    return { ...(await this.preferences(tenantId)), scoreAffected };
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

    const leads = await this.prisma.lead.findMany({
      where: { tenantId, deletedAt: null },
      include: { digitalPresence: true, score: true },
    });

    for (const lead of leads) {
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

      const score = await this.prisma.leadScore.upsert({
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

      await this.prisma.leadScoreReason.deleteMany({ where: { scoreId: score.id } });
      await this.prisma.leadScoreReason.createMany({
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

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'settings.scores.recalculated',
        entityType: 'Tenant',
        entityId: tenantId,
        after: { updated: leads.length },
      },
    });

    return { updated: leads.length };
  }
}
