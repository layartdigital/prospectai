import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  EXPANDABLE_KINDS,
  GRAPH_LIMITS,
  INTELLIGENCE_INCREMENT,
  INTELLIGENCE_MODULE_VERSION,
  SIGNAL_FIELDS,
  aplicarTeto,
  arestas,
  formatNodeRef,
  noActivity,
  noAudit,
  noAuditCheck,
  noContact,
  noFollowUp,
  noLead,
  noNote,
  noPipelineCard,
  noPipelineStage,
  noPresence,
  noScore,
  noScoreReason,
  noSearch,
  noSignal,
  parseNodeRef,
  podeExpandir,
  type GraphEdge,
  type GraphExpandResponse,
  type GraphExpansionOption,
  type GraphLimits,
  type GraphNode,
  type GraphNodeKind,
  type GraphResponse,
  type LeadRow,
  type PresenceRow,
} from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

interface Contexto {
  tx: Tx;
  tenantId: string;
  planCode: string;
  maskPhones: boolean;
}

/** O que o servidor sabe do no pai depois de provar que ele e do tenant. */
type Pai =
  | { kind: 'LEAD'; id: string; searchId: string | null }
  | { kind: 'SEARCH'; id: string }
  | { kind: 'SCORE'; id: string; leadId: string }
  | { kind: 'PRESENCE'; id: string; leadId: string; row: PresenceRow }
  | { kind: 'AUDIT'; id: string; leadId: string }
  | { kind: 'PIPELINE_CARD'; id: string; leadId: string; stageId: string };

interface Pagina {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total: number;
}

const iso = (d: Date): string => d.toISOString();
const isoOuNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

const VAZIA: Pagina = { nodes: [], edges: [], total: 0 };

/**
 * Le o grafo de relacoes de um lead.
 *
 * ---------------------------------------------------------------------------
 * Garantias
 * ---------------------------------------------------------------------------
 *
 * 1. **Tenant em duas camadas.** Toda leitura roda dentro de `comTenant` (RLS
 *    pelo papel de runtime `propectai_app`) **e** leva `tenantId` no `where`.
 *    Se uma das duas falhar, a outra ainda segura. Nao ha uso de
 *    `PrismaSistemaService`: este modulo nao tem caminho privilegiado.
 * 2. **Ids do cliente nunca sao confiados.** `leadId` e `ref` passam por
 *    validacao de formato aqui e por consulta com tenant antes de qualquer
 *    filho ser lido. Id de outro tenant e id inexistente sao indistinguiveis:
 *    ambos respondem 404.
 * 3. **So relacao comprovada.** Cada aresta vem de uma FK (ver
 *    `arestas` em `@propectai/types`). Nenhuma inferencia existe em P04-I1.
 * 4. **Teto em tudo.** Pagina maxima, nos por resposta e profundidade. Nada
 *    devolve a base inteira.
 * 5. **Sem I/O externo** dentro da transacao (regra do `comTenant`).
 */
@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Ponto de integracao com o sistema de planos.
   *
   * **Hoje devolve os tetos tecnicos, iguais para todos os planos.** Nenhuma
   * dimensao comercial (investigacoes por mes, profundidade por plano,
   * creditos de IA, exportacao) foi decidida pelo proprietario, e este metodo
   * nao inventa valores. Quando houver decisao, ela entra aqui — e o resto do
   * modulo, que so le o retorno, nao muda.
   */
  limitesDoPlano(_planCode: string): GraphLimits {
    return { ...GRAPH_LIMITS };
  }

  async carregarGrafo(tenantId: string, planCode: string, leadId: string): Promise<GraphResponse> {
    const parsed = parseNodeRef(formatNodeRef('LEAD', leadId));
    if (!parsed || parsed.kind !== 'LEAD') throw new BadRequestException('leadId inválido');

    const limites = this.limitesDoPlano(planCode);
    const ref = formatNodeRef('LEAD', leadId);

    const { nodes, edges } = await this.prisma.comTenant(tenantId, async (tx) => {
      const ctx = this.contexto(tx, tenantId, planCode);

      const lidos = await this.lerLeads(ctx, [leadId], 0);
      const raiz = lidos.get(leadId);
      if (!raiz) throw new NotFoundException('Lead não encontrado');

      const pai: Pai = { kind: 'LEAD', id: leadId, searchId: raiz.searchId };
      const nodes: GraphNode[] = [raiz.node];
      const edges: GraphEdge[] = [];

      // Relacoes 1:1 entram de saida; as de varios itens ficam em `expansions`.
      for (const kind of ['SEARCH', 'SCORE', 'PRESENCE', 'PIPELINE_CARD'] as const) {
        const pagina = await this.filhos(ctx, pai, kind, 0, 1, 1);
        nodes.push(...pagina.nodes);
        edges.push(...pagina.edges);
      }

      return { nodes, edges };
    });

    const teto = aplicarTeto(nodes, edges, limites.maxNodesPerResponse);
    return this.resposta(ref, teto, limites);
  }

  async expandir(
    tenantId: string,
    planCode: string,
    pedido: { ref: string; kind: GraphNodeKind; offset: number; pageSize: number; parentDepth: number },
  ): Promise<GraphExpandResponse> {
    const parsed = parseNodeRef(pedido.ref);
    if (!parsed) throw new BadRequestException('Referência inválida');
    if (!podeExpandir(parsed.kind, pedido.kind)) {
      throw new BadRequestException('Relação não disponível para este tipo de nó');
    }

    const limites = this.limitesDoPlano(planCode);
    const depthFilho = pedido.parentDepth + 1;
    if (depthFilho > limites.maxDepth) {
      throw new BadRequestException('Profundidade máxima de exploração atingida');
    }
    const pageSize = Math.min(Math.max(pedido.pageSize, 1), limites.maxPageSize);
    const offset = Math.max(pedido.offset, 0);

    const pagina = await this.prisma.comTenant(tenantId, async (tx) => {
      const ctx = this.contexto(tx, tenantId, planCode);
      const pai = await this.resolverPai(ctx, parsed.kind, parsed.id);
      if (!pai) throw new NotFoundException('Nó não encontrado');
      return this.filhos(ctx, pai, pedido.kind, offset, pageSize, depthFilho);
    });

    const teto = aplicarTeto(pagina.nodes, pagina.edges, limites.maxNodesPerResponse);
    const base = this.resposta(pedido.ref, teto, limites);
    const lidos = offset + teto.nodes.length;

    return {
      ...base,
      expanded: {
        ref: pedido.ref,
        kind: pedido.kind,
        nextOffset: lidos < pagina.total ? lidos : null,
      },
    };
  }

  // -------------------------------------------------------------------------

  private contexto(tx: Tx, tenantId: string, planCode: string): Contexto {
    return { tx, tenantId, planCode, maskPhones: !this.entitlements.can(planCode, 'phone.full') };
  }

  private resposta(
    rootRef: string,
    teto: { nodes: GraphNode[]; edges: GraphEdge[]; cortados: Partial<Record<GraphNodeKind, number>> },
    limites: GraphLimits,
  ): GraphResponse {
    return {
      rootRef,
      nodes: teto.nodes,
      edges: teto.edges,
      omitted: teto.cortados,
      limits: limites,
      moduleVersion: INTELLIGENCE_MODULE_VERSION,
      increment: INTELLIGENCE_INCREMENT,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Prova que o no pai existe **neste tenant** e reune o que os filhos precisam. */
  private async resolverPai(ctx: Contexto, kind: GraphNodeKind, id: string): Promise<Pai | null> {
    const { tx, tenantId } = ctx;

    switch (kind) {
      case 'LEAD': {
        const r = await tx.lead.findFirst({
          where: { id, tenantId, deletedAt: null },
          select: { id: true, searchId: true },
        });
        return r ? { kind, id: r.id, searchId: r.searchId } : null;
      }
      case 'SEARCH': {
        const r = await tx.prospectingSearch.findFirst({
          where: { id, tenantId, deletedAt: null },
          select: { id: true },
        });
        return r ? { kind, id: r.id } : null;
      }
      case 'SCORE': {
        const r = await tx.leadScore.findFirst({ where: { id, tenantId }, select: { id: true, leadId: true } });
        return r ? { kind, id: r.id, leadId: r.leadId } : null;
      }
      case 'PRESENCE': {
        const r = await tx.leadDigitalPresence.findFirst({ where: { id, tenantId } });
        return r ? { kind, id: r.id, leadId: r.leadId, row: this.linhaPresenca(r) } : null;
      }
      case 'AUDIT': {
        const r = await tx.digitalPresenceAudit.findFirst({ where: { id, tenantId }, select: { id: true, leadId: true } });
        return r ? { kind, id: r.id, leadId: r.leadId } : null;
      }
      case 'PIPELINE_CARD': {
        const r = await tx.pipelineCard.findFirst({
          where: { id, tenantId },
          select: { id: true, leadId: true, stageId: true },
        });
        return r ? { kind, id: r.id, leadId: r.leadId, stageId: r.stageId } : null;
      }
      default:
        return null;
    }
  }

  private linhaPresenca(r: {
    id: string;
    leadId: string;
    hasWebsite: PresenceRow['hasWebsite'];
    hasEmail: PresenceRow['hasEmail'];
    hasPhone: PresenceRow['hasPhone'];
    hasInstagram: PresenceRow['hasInstagram'];
    hasFacebook: PresenceRow['hasFacebook'];
    hasReviews: PresenceRow['hasReviews'];
    websiteHasHttps: PresenceRow['websiteHasHttps'];
    whatsappStatus: string;
    lastCheckedAt: Date | null;
  }): PresenceRow {
    return {
      id: r.id,
      leadId: r.leadId,
      hasWebsite: r.hasWebsite,
      hasEmail: r.hasEmail,
      hasPhone: r.hasPhone,
      hasInstagram: r.hasInstagram,
      hasFacebook: r.hasFacebook,
      hasReviews: r.hasReviews,
      websiteHasHttps: r.websiteHasHttps,
      whatsappStatus: r.whatsappStatus,
      lastCheckedAt: isoOuNull(r.lastCheckedAt),
    };
  }

  /**
   * Le leads do tenant e monta o no de cada um, com a contagem de cada relacao
   * em `expansions`. Uma consulta por tipo (agrupada), e nao uma por lead.
   */
  private async lerLeads(
    ctx: Contexto,
    ids: string[],
    depth: number,
  ): Promise<Map<string, { node: GraphNode; searchId: string | null }>> {
    const { tx, tenantId } = ctx;
    const saida = new Map<string, { node: GraphNode; searchId: string | null }>();
    if (ids.length === 0) return saida;

    const leads = await tx.lead.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        category: true,
        addressCity: true,
        addressStateUf: true,
        websiteStatus: true,
        website: true,
        email: true,
        phoneRaw: true,
        reviewCount: true,
        reviewRating: true,
        isFavorite: true,
        isDisqualified: true,
        createdAt: true,
        searchId: true,
      },
    });
    if (leads.length === 0) return saida;

    const achados = leads.map((l) => l.id);
    const porLead = { leadId: { in: achados }, tenantId };

    const [scores, presencas, cartoes, auditorias, atividades, notas, contatos, followUps] = await Promise.all([
      tx.leadScore.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.leadDigitalPresence.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.pipelineCard.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.digitalPresenceAudit.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.leadActivity.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.leadNote.groupBy({ by: ['leadId'], where: { ...porLead, deletedAt: null }, _count: { _all: true } }),
      tx.leadContactRecord.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
      tx.leadFollowUp.groupBy({ by: ['leadId'], where: porLead, _count: { _all: true } }),
    ]);

    const buscaIds = [...new Set(leads.map((l) => l.searchId).filter((s): s is string => Boolean(s)))];
    const buscasVivas = new Set(
      buscaIds.length === 0
        ? []
        : (
            await tx.prospectingSearch.findMany({
              where: { id: { in: buscaIds }, tenantId, deletedAt: null },
              select: { id: true },
            })
          ).map((b) => b.id),
    );

    const mapa = (linhas: { leadId: string; _count: { _all: number } }[]): Map<string, number> =>
      new Map(linhas.map((l) => [l.leadId, l._count._all] as const));
    const c = {
      SCORE: mapa(scores),
      PRESENCE: mapa(presencas),
      PIPELINE_CARD: mapa(cartoes),
      AUDIT: mapa(auditorias),
      ACTIVITY: mapa(atividades),
      NOTE: mapa(notas),
      CONTACT_RECORD: mapa(contatos),
      FOLLOW_UP: mapa(followUps),
    };

    for (const l of leads) {
      const total = (kind: GraphNodeKind): number => {
        if (kind === 'SEARCH') return l.searchId && buscasVivas.has(l.searchId) ? 1 : 0;
        return (c as Record<string, Map<string, number>>)[kind]?.get(l.id) ?? 0;
      };
      const expansions: GraphExpansionOption[] = (EXPANDABLE_KINDS.LEAD ?? []).map((kind) => ({
        kind,
        total: total(kind),
        loaded: 0,
      }));

      const row: LeadRow = {
        id: l.id,
        name: l.name,
        category: l.category,
        city: l.addressCity,
        stateUf: l.addressStateUf,
        websiteStatus: l.websiteStatus,
        website: l.website,
        email: l.email,
        // A mascara e aplicada aqui, no servidor, como em `LeadsService`.
        phone: ctx.maskPhones
          ? this.entitlements.maskPhone(l.phoneRaw, ctx.planCode)
          : l.phoneRaw,
        phoneIsMasked: ctx.maskPhones,
        reviewCount: l.reviewCount,
        reviewRating: l.reviewRating,
        isFavorite: l.isFavorite,
        isDisqualified: l.isDisqualified,
        createdAt: iso(l.createdAt),
        searchId: l.searchId,
      };

      saida.set(l.id, { node: noLead(row, depth, expansions), searchId: l.searchId });
    }

    return saida;
  }

  /** Uma pagina de filhos de `kind` sob `pai`. Sempre com `tenantId` no where. */
  private async filhos(
    ctx: Contexto,
    pai: Pai,
    kind: GraphNodeKind,
    offset: number,
    pageSize: number,
    depth: number,
  ): Promise<Pagina> {
    const { tx, tenantId } = ctx;
    const paiRef = formatNodeRef(pai.kind, pai.id);

    switch (`${pai.kind}>${kind}`) {
      case 'LEAD>SEARCH': {
        if (pai.kind !== 'LEAD' || !pai.searchId || offset > 0) return VAZIA;
        const s = await tx.prospectingSearch.findFirst({
          where: { id: pai.searchId, tenantId, deletedAt: null },
          select: { id: true, niche: true, city: true, stateUf: true, leadsFound: true, createdAt: true },
        });
        if (!s) return VAZIA;
        const noLeads = await tx.lead.count({ where: { searchId: s.id, tenantId, deletedAt: null } });
        const node = noSearch({ ...s, createdAt: iso(s.createdAt) }, depth, noLeads, 0);
        return { nodes: [node], edges: [arestas.pesquisaDoLead(paiRef, node.ref)], total: 1 };
      }

      case 'LEAD>SCORE': {
        if (offset > 0) return VAZIA;
        const s = await tx.leadScore.findFirst({ where: { leadId: pai.id, tenantId } });
        if (!s) return VAZIA;
        const motivos = await tx.leadScoreReason.count({ where: { scoreId: s.id, tenantId } });
        const node = noScore(
          {
            id: s.id,
            leadId: s.leadId,
            value: s.value,
            level: s.level,
            algorithmVersion: s.algorithmVersion,
            calculatedAt: iso(s.calculatedAt),
          },
          depth,
          motivos,
          0,
        );
        return { nodes: [node], edges: [arestas.scoreDoLead(paiRef, node.ref, iso(s.calculatedAt))], total: 1 };
      }

      case 'LEAD>PRESENCE': {
        if (offset > 0) return VAZIA;
        const r = await tx.leadDigitalPresence.findFirst({ where: { leadId: pai.id, tenantId } });
        if (!r) return VAZIA;
        const node = noPresence(this.linhaPresenca(r), depth, 0);
        return { nodes: [node], edges: [arestas.presencaDoLead(paiRef, node.ref)], total: 1 };
      }

      case 'LEAD>PIPELINE_CARD': {
        if (offset > 0) return VAZIA;
        const c = await tx.pipelineCard.findFirst({ where: { leadId: pai.id, tenantId } });
        if (!c) return VAZIA;
        const node = noPipelineCard(
          { id: c.id, leadId: c.leadId, stageId: c.stageId, enteredStageAt: iso(c.enteredStageAt), estimatedValue: c.estimatedValue },
          depth,
        );
        return { nodes: [node], edges: [arestas.cartaoDoLead(paiRef, node.ref)], total: 1 };
      }

      case 'LEAD>AUDIT': {
        const where = { leadId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.digitalPresenceAudit.count({ where }),
          tx.digitalPresenceAudit.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true, leadId: true, status: true, auditVersion: true, createdAt: true, finishedAt: true },
          }),
        ]);
        const checagens = linhas.length
          ? await tx.digitalPresenceCheck.groupBy({
              by: ['auditId'],
              where: { auditId: { in: linhas.map((a) => a.id) }, tenantId },
              _count: { _all: true },
            })
          : [];
        const porAudit = new Map(checagens.map((x) => [x.auditId, x._count._all] as const));
        const nodes = linhas.map((a) =>
          noAudit(
            { ...a, createdAt: iso(a.createdAt), finishedAt: isoOuNull(a.finishedAt) },
            depth,
            porAudit.get(a.id) ?? 0,
            0,
          ),
        );
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.auditoriaDoLead(paiRef, n.ref, iso((linhas[i] as (typeof linhas)[number]).createdAt))),
          total,
        };
      }

      case 'LEAD>ACTIVITY': {
        const where = { leadId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.leadActivity.count({ where }),
          tx.leadActivity.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            // `metadata` fica de fora de proposito: e JSON livre e pode conter
            // dado que a tela nao precisa para desenhar a relacao.
            select: { id: true, leadId: true, type: true, createdAt: true },
          }),
        ]);
        const nodes = linhas.map((a) => noActivity({ ...a, createdAt: iso(a.createdAt) }, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.atividadeDoLead(paiRef, n.ref, iso((linhas[i] as (typeof linhas)[number]).createdAt))),
          total,
        };
      }

      case 'LEAD>NOTE': {
        const where = { leadId: pai.id, tenantId, deletedAt: null };
        const [total, linhas] = await Promise.all([
          tx.leadNote.count({ where }),
          tx.leadNote.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true, leadId: true, content: true, createdAt: true },
          }),
        ]);
        const nodes = linhas.map((n) => noNote({ ...n, createdAt: iso(n.createdAt) }, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.notaDoLead(paiRef, n.ref, iso((linhas[i] as (typeof linhas)[number]).createdAt))),
          total,
        };
      }

      case 'LEAD>CONTACT_RECORD': {
        const where = { leadId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.leadContactRecord.count({ where }),
          tx.leadContactRecord.findMany({
            where,
            orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true, leadId: true, channel: true, direction: true, outcome: true, occurredAt: true },
          }),
        ]);
        const nodes = linhas.map((c) => noContact({ ...c, occurredAt: iso(c.occurredAt) }, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.contatoDoLead(paiRef, n.ref, iso((linhas[i] as (typeof linhas)[number]).occurredAt))),
          total,
        };
      }

      case 'LEAD>FOLLOW_UP': {
        const where = { leadId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.leadFollowUp.count({ where }),
          tx.leadFollowUp.findMany({
            where,
            orderBy: [{ dueAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true, leadId: true, channel: true, priority: true, status: true, dueAt: true },
          }),
        ]);
        const nodes = linhas.map((f) => noFollowUp({ ...f, dueAt: iso(f.dueAt) }, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.followUpDoLead(paiRef, n.ref, iso((linhas[i] as (typeof linhas)[number]).dueAt))),
          total,
        };
      }

      case 'SEARCH>LEAD': {
        const where = { searchId: pai.id, tenantId, deletedAt: null };
        const [total, ids] = await Promise.all([
          tx.lead.count({ where }),
          tx.lead.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true },
          }),
        ]);
        const lidos = await this.lerLeads(ctx, ids.map((i) => i.id), depth);
        const nodes = ids.flatMap((i) => {
          const l = lidos.get(i.id);
          return l ? [l.node] : [];
        });
        // A aresta vai do lead para a pesquisa: e assim que a FK aponta.
        return { nodes, edges: nodes.map((n) => arestas.pesquisaDoLead(n.ref, paiRef)), total };
      }

      case 'SCORE>SCORE_REASON': {
        const leadId = pai.kind === 'SCORE' ? pai.leadId : '';
        const where = { scoreId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.leadScoreReason.count({ where }),
          tx.leadScoreReason.findMany({
            where,
            orderBy: [{ weight: 'desc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            select: { id: true, scoreId: true, code: true, label: true, weight: true, polarity: true, evidence: true },
          }),
        ]);
        const nodes = linhas.map((r) => noScoreReason(r, leadId, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.motivoDoScore(paiRef, n.ref, (linhas[i] as (typeof linhas)[number]).weight)),
          total,
        };
      }

      case 'PRESENCE>SIGNAL': {
        if (pai.kind !== 'PRESENCE') return VAZIA;
        const campos = SIGNAL_FIELDS.slice(offset, offset + pageSize);
        const nodes = campos.map((campo) => noSignal(pai.row, campo, depth));
        return {
          nodes,
          edges: nodes.map((n, i) => arestas.sinalDaPresenca(paiRef, n.ref, campos[i] as (typeof campos)[number])),
          total: SIGNAL_FIELDS.length,
        };
      }

      case 'AUDIT>AUDIT_CHECK': {
        const leadId = pai.kind === 'AUDIT' ? pai.leadId : '';
        const where = { auditId: pai.id, tenantId };
        const [total, linhas] = await Promise.all([
          tx.digitalPresenceCheck.count({ where }),
          tx.digitalPresenceCheck.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip: offset,
            take: pageSize,
            // `result` e `observedUrl` ficam de fora: JSON livre / URL do site do
            // prospect. O detalhe completo continua na ficha do lead.
            select: { id: true, auditId: true, check: true, outcome: true, observedAt: true, confidence: true },
          }),
        ]);
        const nodes = linhas.map((c) => noAuditCheck({ ...c, observedAt: isoOuNull(c.observedAt) }, leadId, depth));
        return { nodes, edges: nodes.map((n) => arestas.checagemDaAuditoria(paiRef, n.ref)), total };
      }

      case 'PIPELINE_CARD>PIPELINE_STAGE': {
        if (pai.kind !== 'PIPELINE_CARD' || offset > 0) return VAZIA;
        const e = await tx.pipelineStage.findFirst({
          where: { id: pai.stageId, tenantId },
          select: { id: true, name: true, slug: true, order: true, isTerminal: true, isWon: true },
        });
        if (!e) return VAZIA;
        const node = noPipelineStage(e, depth);
        return { nodes: [node], edges: [arestas.etapaDoCartao(paiRef, node.ref)], total: 1 };
      }

      default:
        // `podeExpandir` ja barrou antes; chegar aqui e erro de programacao.
        throw new BadRequestException('Relação não disponível para este tipo de nó');
    }
  }
}
