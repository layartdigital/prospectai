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
    ] = await this.prisma.comTenant(tenantId, (tx) =>
      /**
       * **Um bloco só para as doze, e a razão é medida.**
       *
       * Uma transacao do Prisma roda tudo numa conexao, entao envolver aqui
       * **serializa** as doze consultas que hoje correm em paralelo. Parecia
       * motivo para nao envolver. O `rls:bench` disse o contrario:
       *
       *   solto (paralelo, sem contexto)      13,3 ms p50
       *   um bloco (1 comTenant, serial)      37,4 ms
       *   doze blocos (12 comTenant)          52,1 ms
       *
       * Doze transacoes concorrentes custam mais que doze consultas em fila, e
       * ainda disputam o pool entre si — o que piora com usuarios simultaneos,
       * nao melhora.
       *
       * O preco esta registrado: esta tela sai de 13 ms para 37 ms de p50. E
       * abre um trabalho que antes nao valia a pena — varias destas contagens
       * sao sobre `leads` com filtros diferentes e cabem numa consulta so com
       * agregacao condicional. Serializadas, reduzir doze para quatro compensa.
       */
      Promise.all([
      tx.lead.count({ where: activeLeads }),

      tx.lead.count({
        where: { ...activeLeads, createdAt: { gte: startOfMonth } },
      }),

      tx.lead.count({
        where: { ...activeLeads, score: { value: { gte: 70 } } },
      }),

      // "Ativo" exclui as etapas terminais: fechado e perdido não estão
      // em acompanhamento, estão resolvidos.
      tx.pipelineCard.count({
        where: { tenantId, stage: { isTerminal: false } },
      }),

      tx.leadScore.aggregate({
        where: { tenantId, lead: { deletedAt: null } },
        _avg: { value: true },
      }),

      tx.lead.count({
        where: { ...activeLeads, websiteStatus: 'SEM_SITE' },
      }),

      tx.lead.count({
        where: { ...activeLeads, websiteStatus: 'SITE_PRECARIO' },
      }),

      tx.lead.count({
        where: {
          ...activeLeads,
          digitalPresence: { whatsappStatus: { in: ['LIKELY', 'VERIFIED'] } },
        },
      }),

      tx.leadFollowUp.count({
        where: { tenantId, status: 'PENDING' },
      }),

      tx.leadFollowUp.count({
        where: { tenantId, status: 'OVERDUE' },
      }),

      tx.prospectingSearch.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { leads: true } },
        },
      }),

      tx.pipelineStage.findMany({
        where: { tenantId },
        orderBy: { order: 'asc' },
        include: { _count: { select: { cards: true } } },
      }),
      ]),
    );

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
