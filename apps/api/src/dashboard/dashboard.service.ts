import { Injectable } from '@nestjs/common';
import type { DashboardResponse } from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos os números saem de query no tenant ativo.
   *
   * Nenhum valor é calculado no front-end e nenhum é constante — se um KPI
   * aparecer na tela, ele veio daqui.
   */
  async overview(tenantId: string): Promise<DashboardResponse> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const activeLeads = { tenantId, deletedAt: null };

    const [
      leadsFound,
      leadsThisMonth,
      highOpportunities,
      pipelineActive,
      scoreAggregate,
      withoutWebsite,
      poorWebsite,
      likelyWhatsapp,
      pendingFollowUps,
      overdueFollowUps,
      searches,
      stages,
    ] = await Promise.all([
      this.prisma.lead.count({ where: activeLeads }),

      this.prisma.lead.count({
        where: { ...activeLeads, createdAt: { gte: startOfMonth } },
      }),

      this.prisma.lead.count({
        where: { ...activeLeads, score: { value: { gte: 70 } } },
      }),

      // "Ativo" exclui as etapas terminais: fechado e perdido não estão
      // em acompanhamento, estão resolvidos.
      this.prisma.pipelineCard.count({
        where: { tenantId, stage: { isTerminal: false } },
      }),

      this.prisma.leadScore.aggregate({
        where: { tenantId, lead: { deletedAt: null } },
        _avg: { value: true },
      }),

      this.prisma.lead.count({
        where: { ...activeLeads, websiteStatus: 'SEM_SITE' },
      }),

      this.prisma.lead.count({
        where: { ...activeLeads, websiteStatus: 'SITE_PRECARIO' },
      }),

      this.prisma.lead.count({
        where: {
          ...activeLeads,
          digitalPresence: { whatsappStatus: { in: ['LIKELY', 'VERIFIED'] } },
        },
      }),

      this.prisma.leadFollowUp.count({
        where: { tenantId, status: 'PENDING' },
      }),

      this.prisma.leadFollowUp.count({
        where: { tenantId, status: 'OVERDUE' },
      }),

      this.prisma.prospectingSearch.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { leads: true } },
        },
      }),

      this.prisma.pipelineStage.findMany({
        where: { tenantId },
        orderBy: { order: 'asc' },
        include: { _count: { select: { cards: true } } },
      }),
    ]);

    return {
      kpis: {
        leadsFound,
        leadsThisMonth,
        highOpportunities,
        pipelineActive,
        averageScore: Math.round(scoreAggregate._avg.value ?? 0),
        withoutOwnWebsite: withoutWebsite + poorWebsite,
        withoutWebsite,
        poorWebsite,
        likelyWhatsapp,
        pendingFollowUps,
        overdueFollowUps,
      },

      recentSearches: searches.map((search) => ({
        id: search.id,
        niche: search.niche,
        city: search.city,
        stateUf: search.stateUf,
        leadsFound: search._count.leads,
        status: search.jobs[0]?.status ?? 'PENDING',
        createdAt: search.createdAt.toISOString(),
      })),

      funnel: stages.map((stage) => ({
        slug: stage.slug,
        name: stage.name,
        color: stage.color,
        count: stage._count.cards,
      })),
    };
  }
}
