import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  HistoryResponse,
  PipelineBoard,
  ScoreLevelName,
  WebsiteStatus,
  WhatsAppStatus,
} from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Pipeline — primeira familia do passo 6 do `PLANO-RLS-v1.md`.
 *
 * **A regra de escopo aparece aqui pela primeira vez.** O passo 3 mediu que o
 * custo do `comTenant` e por chamada, nao por requisicao: cerca de 5 ms de
 * transacao mais `set_config`. Uma tela de quadro que fizesse cinco consultas
 * em cinco chamadas pagaria cinco vezes.
 *
 * Por isso cada metodo publico abre **um** `comTenant` e faz tudo dentro. O
 * canario nunca exercitou isso — la eram duas transacoes porque havia uma
 * chamada de rede de 30s no meio, e essa e a unica razao aceita para dividir.
 */
@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async board(tenantId: string): Promise<PipelineBoard> {
    const stages = await this.prisma.comTenant(tenantId, (tx) =>
      tx.pipelineStage.findMany({
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
      }),
    );

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
   *
   * **As três escritas passaram a ser atômicas**, e isso é efeito colateral do
   * `comTenant`, não intenção separada. Antes eram três statements soltos: se o
   * segundo falhasse, o card ficava movido sem transição registrada, e o
   * histórico passava a mentir sobre como ele chegou ali. Agora vivem ou morrem
   * juntos.
   *
   * A regra do helper vale aqui como em qualquer lugar: **nada de I/O externo
   * dentro do bloco.** Se um dia isto precisar notificar alguém, a notificação
   * sai depois do commit.
   */
  async moveCard(
    tenantId: string,
    cardId: string,
    userId: string,
    stageSlug: string,
    position: number,
  ): Promise<{ ok: true }> {
    await this.prisma.comTenant(tenantId, async (tx) => {
      // Chave composta em vez de `findFirst({ id, tenantId })`: mesma garantia,
      // dita pelo indice em vez de pela clausula. Com a politica ligada, as
      // duas defesas passam a valer — e nenhuma delas depende de alguem lembrar.
      const card = await tx.pipelineCard.findUnique({
        where: { tenantId_id: { tenantId, id: cardId } },
      });
      if (!card) throw new NotFoundException('Card não encontrado');

      const stage = await tx.pipelineStage.findUnique({
        where: { tenantId_slug: { tenantId, slug: stageSlug } },
      });
      if (!stage) throw new NotFoundException('Etapa não encontrada');

      const changedStage = card.stageId !== stage.id;

      await tx.pipelineCard.update({
        where: { tenantId_id: { tenantId, id: cardId } },
        data: {
          stageId: stage.id,
          position,
          ...(changedStage ? { enteredStageAt: new Date() } : {}),
        },
      });

      if (!changedStage) return;

      await tx.pipelineTransition.create({
        data: {
          tenantId,
          cardId,
          fromStageId: card.stageId,
          toStageId: stage.id,
          changedById: userId,
          origin: 'pipeline-board',
        },
      });

      await tx.leadActivity.create({
        data: {
          tenantId,
          leadId: card.leadId,
          actorId: userId,
          type: 'STAGE_CHANGED',
          metadata: { to: stage.slug, origin: 'pipeline-board' },
        },
      });
    });

    return { ok: true };
  }

  /**
   * Histórico de buscas.
   *
   * **Não toca em nenhuma tabela de pipeline** — lê `prospecting_searches` e
   * `scrape_jobs`, que são a família 3. O `comTenant` entra aqui agora mesmo
   * assim: enquanto essas tabelas não tiverem política, ele não muda nada além
   * de abrir uma transação; quando tiverem, este método já está pronto.
   *
   * O contrário — deixar para embrulhar no dia da família 3 — é como a lista do
   * `tenant.guard.ts` envelhece: alguém precisa lembrar, e um dia não lembra.
   */
  async history(tenantId: string): Promise<HistoryResponse> {
    const searches = await this.prisma.comTenant(tenantId, (tx) =>
      tx.prospectingSearch.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { leads: true } },
        },
      }),
    );

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
