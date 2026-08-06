import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  HistoryResponse,
  PipelineBoard,
  ScoreLevelName,
  WebsiteStatus,
  WhatsAppStatus,
} from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async board(tenantId: string): Promise<PipelineBoard> {
    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId },
      orderBy: { order: 'asc' },
      include: {
        cards: {
          orderBy: { position: 'asc' },
          include: {
            owner: true,
            lead: { include: { score: true, digitalPresence: true } },
          },
        },
      },
    });

    const total = stages.reduce((sum, stage) => sum + stage.cards.length, 0);

    return {
      total,
      columns: stages.map((stage) => ({
        id: stage.id,
        slug: stage.slug,
        name: stage.name,
        color: stage.color,
        order: stage.order,
        isTerminal: stage.isTerminal,
        cards: stage.cards.map((card) => ({
          id: card.id,
          leadId: card.leadId,
          name: card.lead.name,
          category: card.lead.category,
          city: card.lead.addressCity,
          stateUf: card.lead.addressStateUf,
          score: card.lead.score?.value ?? 0,
          scoreLevel: (card.lead.score?.level ?? 'BAIXA') as ScoreLevelName,
          websiteStatus: card.lead.websiteStatus as WebsiteStatus,
          whatsappStatus: (card.lead.digitalPresence?.whatsappStatus ??
            'UNKNOWN') as WhatsAppStatus,
          ownerName: card.owner?.name ?? null,
          position: card.position,
          enteredStageAt: card.enteredStageAt.toISOString(),
        })),
      })),
    };
  }

  /**
   * Move um card entre colunas.
   *
   * A interface aplica a mudança de forma otimista; se este método falhar,
   * o front desfaz. Por isso a validação de tenant vem antes de qualquer
   * escrita — mover card de outro workspace precisa falhar limpo.
   */
  async moveCard(
    tenantId: string,
    cardId: string,
    userId: string,
    stageSlug: string,
    position: number,
  ): Promise<{ ok: true }> {
    const card = await this.prisma.pipelineCard.findFirst({
      where: { id: cardId, tenantId },
    });
    if (!card) throw new NotFoundException('Card não encontrado');

    const stage = await this.prisma.pipelineStage.findUnique({
      where: { tenantId_slug: { tenantId, slug: stageSlug } },
    });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    const changedStage = card.stageId !== stage.id;

    await this.prisma.pipelineCard.update({
      where: { id: cardId },
      data: {
        stageId: stage.id,
        position,
        ...(changedStage ? { enteredStageAt: new Date() } : {}),
      },
    });

    if (changedStage) {
      await this.prisma.pipelineTransition.create({
        data: {
          tenantId,
          cardId,
          fromStageId: card.stageId,
          toStageId: stage.id,
          changedById: userId,
          origin: 'pipeline-board',
        },
      });

      await this.prisma.leadActivity.create({
        data: {
          tenantId,
          leadId: card.leadId,
          actorId: userId,
          type: 'STAGE_CHANGED',
          metadata: { to: stage.slug, origin: 'pipeline-board' },
        },
      });
    }

    return { ok: true };
  }

  async history(tenantId: string): Promise<HistoryResponse> {
    const searches = await this.prisma.prospectingSearch.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { leads: true } },
      },
    });

    const totalLeads = searches.reduce(
      (sum, search) => sum + search._count.leads,
      0,
    );
    const totalDuplicates = searches.reduce(
      (sum, search) => sum + search.duplicatesFound,
      0,
    );

    const returnedBySource = totalLeads + totalDuplicates;

    return {
      items: searches.map((search) => ({
        id: search.id,
        niche: search.niche,
        city: search.city,
        stateUf: search.stateUf,
        neighborhood: search.neighborhood,
        requestedCount: search.requestedCount,
        leadsFound: search._count.leads,
        duplicatesFound: search.duplicatesFound,
        status: search.jobs[0]?.status ?? 'PENDING',
        durationMs: search.jobs[0]?.durationMs ?? null,
        errorMessage: search.jobs[0]?.errorMessage ?? null,
        createdAt: search.createdAt.toISOString(),
      })),
      kpis: {
        totalSearches: searches.length,
        totalLeads,
        averagePerSearch:
          searches.length > 0 ? Math.round(totalLeads / searches.length) : 0,
        duplicateRate:
          returnedBySource > 0
            ? Math.round((totalDuplicates / returnedBySource) * 100)
            : 0,
      },
    };
  }
}
