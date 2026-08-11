import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeScore,
  type LeadDetail,
  type LeadFacets,
  type LeadListResponse,
  type PlanCode,
  type ScoreInput,
  type ScoreLevelName,
  type WebsiteStatus,
  type WhatsAppStatus,
} from '@propectai/types';

import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import type { LeadQueryDto } from './leads.dto';

/** Etapas onde o lead ainda não está resolvido. */
const OPEN_WEBSITE_STATUSES: WebsiteStatus[] = ['SEM_SITE', 'SITE_PRECARIO'];

/**
 * Teto da exportação síncrona.
 *
 * O maior plano inclui 3.000 leads, então o teto não corta ninguém na prática.
 * Existe como trava: exportação sem limite é o caminho mais curto para derrubar
 * a API com uma requisição só. Acima disso, o caminho certo é `ExportJob`
 * assíncrono, que já está modelado no schema e fica para quando fizer falta.
 */
const EXPORT_MAX_ROWS = 5000;

/** Rótulos legíveis. O CSV é lido por pessoa, não por máquina. */
const WEBSITE_STATUS_LABEL: Record<string, string> = {
  SEM_SITE: 'Sem site',
  SITE_PRECARIO: 'Site precário',
  SITE_PROPRIO: 'Site próprio',
};

const WHATSAPP_STATUS_LABEL: Record<string, string> = {
  VERIFIED: 'Confirmado',
  LIKELY: 'Provável',
  UNKNOWN: 'Não verificado',
};

/**
 * Escapa um campo de CSV.
 *
 * Aspas, ponto e vírgula e quebra de linha dentro do valor quebram o arquivo
 * silenciosamente — a planilha abre, com as colunas deslocadas a partir da
 * linha ruim. Nome de empresa com aspas não é caso raro.
 */
function csvCampo(valor: string): string {
  if (!/[";\r\n]/.test(valor)) return valor;
  return `"${valor.replace(/"/g, '""')}"`;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listagem
  // ---------------------------------------------------------------------------

  async list(
    tenantId: string,
    planCode: PlanCode,
    query: LeadQueryDto,
  ): Promise<LeadListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = this.buildWhere(tenantId, query);

    const orderBy: Prisma.LeadOrderByWithRelationInput =
      query.sortBy === 'name'
        ? { name: query.sortDir ?? 'asc' }
        : query.sortBy === 'createdAt'
          ? { createdAt: query.sortDir ?? 'desc' }
          : { score: { value: query.sortDir ?? 'desc' } };

    const [items, total, withoutOwnWebsite, likelyWhatsapp, highOpportunity] =
      await Promise.all([
        this.prisma.lead.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            score: true,
            digitalPresence: true,
            pipelineCard: { include: { stage: true } },
          },
        }),
        this.prisma.lead.count({ where }),
        this.prisma.lead.count({
          where: { ...where, websiteStatus: { in: OPEN_WEBSITE_STATUSES } },
        }),
        this.prisma.lead.count({
          where: {
            ...where,
            digitalPresence: { whatsappStatus: { in: ['LIKELY', 'VERIFIED'] } },
          },
        }),
        this.prisma.lead.count({ where: { ...where, score: { value: { gte: 70 } } } }),
      ]);

    const maskPhones = !this.entitlements.can(planCode, 'phone.full');

    return {
      items: items.map((lead) => ({
        id: lead.id,
        name: lead.name,
        category: lead.category,
        city: lead.addressCity,
        stateUf: lead.addressStateUf,
        phone: maskPhones
          ? this.entitlements.maskPhone(lead.phoneRaw, planCode)
          : lead.phoneRaw,
        phoneIsMasked: maskPhones,
        website: lead.website,
        websiteStatus: lead.websiteStatus as WebsiteStatus,
        whatsappStatus: (lead.digitalPresence?.whatsappStatus ??
          'UNKNOWN') as WhatsAppStatus,
        hasInstagram: lead.digitalPresence?.hasInstagram ?? 'DESCONHECIDO',
        reviewCount: lead.reviewCount,
        reviewRating: lead.reviewRating,
        score: lead.score?.value ?? 0,
        scoreLevel: (lead.score?.level ?? 'BAIXA') as ScoreLevelName,
        isFavorite: lead.isFavorite,
        isDisqualified: lead.isDisqualified,
        stageSlug: lead.pipelineCard?.stage.slug ?? null,
        stageName: lead.pipelineCard?.stage.name ?? null,
        createdAt: lead.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: { withoutOwnWebsite, likelyWhatsapp, highOpportunity },
    };
  }

  /** Opções de filtro derivadas do acervo real — não de uma lista fixa. */
  async facets(tenantId: string): Promise<LeadFacets> {
    const [states, cities, categories, stages] = await Promise.all([
      this.prisma.lead.findMany({
        where: { tenantId, deletedAt: null, addressStateUf: { not: null } },
        distinct: ['addressStateUf'],
        select: { addressStateUf: true },
        orderBy: { addressStateUf: 'asc' },
      }),
      this.prisma.lead.findMany({
        where: { tenantId, deletedAt: null, addressCity: { not: null } },
        distinct: ['addressCity'],
        select: { addressCity: true },
        orderBy: { addressCity: 'asc' },
      }),
      this.prisma.lead.findMany({
        where: { tenantId, deletedAt: null, category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.pipelineStage.findMany({
        where: { tenantId },
        orderBy: { order: 'asc' },
      }),
    ]);

    return {
      states: states.map((s) => s.addressStateUf).filter((v): v is string => Boolean(v)),
      cities: cities.map((c) => c.addressCity).filter((v): v is string => Boolean(v)),
      categories: categories
        .map((c) => c.category)
        .filter((v): v is string => Boolean(v)),
      stages: stages.map((stage) => ({
        id: stage.id,
        slug: stage.slug,
        name: stage.name,
        color: stage.color,
        order: stage.order,
        isTerminal: stage.isTerminal,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Detalhe
  // ---------------------------------------------------------------------------

  async findOne(
    tenantId: string,
    leadId: string,
    planCode: PlanCode,
  ): Promise<LeadDetail> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null },
      include: {
        score: { include: { reasons: { orderBy: { weight: 'desc' } } } },
        digitalPresence: true,
        pipelineCard: { include: { stage: true, owner: true } },
        notes: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { author: true },
        },
        contactRecords: {
          orderBy: { occurredAt: 'desc' },
          include: { author: true },
        },
        followUps: { orderBy: { dueAt: 'asc' }, include: { owner: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { actor: true },
        },
      },
    });

    // 404 e não 403: confirmar que o recurso existe em outro tenant já é
    // vazamento de informação.
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId },
      orderBy: { order: 'asc' },
    });

    const maskPhones = !this.entitlements.can(planCode, 'phone.full');
    const reasons = lead.score?.reasons ?? [];

    const nextFollowUp = lead.followUps.find(
      (item) => item.status === 'PENDING' || item.status === 'OVERDUE',
    );

    return {
      id: lead.id,
      name: lead.name,
      category: lead.category,

      phone: maskPhones
        ? this.entitlements.maskPhone(lead.phoneRaw, planCode)
        : lead.phoneRaw,
      phoneIsMasked: maskPhones,
      // Link só existe quando há número compatível e o plano libera o número
      // completo. Montar wa.me com telefone mascarado geraria link quebrado.
      whatsappUrl:
        !maskPhones &&
        lead.phoneE164 &&
        lead.digitalPresence?.whatsappStatus !== 'UNKNOWN'
          ? `https://wa.me/${lead.phoneE164.replace(/\D/g, '')}`
          : null,
      email: lead.email,

      website: lead.website,
      websiteStatus: lead.websiteStatus as WebsiteStatus,

      address: {
        street: lead.addressStreet,
        neighborhood: lead.addressNeighborhood,
        city: lead.addressCity,
        stateUf: lead.addressStateUf,
        postalCode: lead.addressPostalCode,
        full: lead.addressFull,
        mapsUrl: lead.addressFull
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.addressFull)}`
          : null,
      },

      openHours: (lead.openHours as Record<string, string[]> | null) ?? null,
      reviewCount: lead.reviewCount,
      reviewRating: lead.reviewRating,

      presence: {
        hasWebsite: lead.digitalPresence?.hasWebsite ?? 'DESCONHECIDO',
        hasEmail: lead.digitalPresence?.hasEmail ?? 'DESCONHECIDO',
        hasPhone: lead.digitalPresence?.hasPhone ?? 'DESCONHECIDO',
        hasInstagram: lead.digitalPresence?.hasInstagram ?? 'DESCONHECIDO',
        hasFacebook: lead.digitalPresence?.hasFacebook ?? 'DESCONHECIDO',
        hasReviews: lead.digitalPresence?.hasReviews ?? 'DESCONHECIDO',
        whatsappStatus: (lead.digitalPresence?.whatsappStatus ??
          'UNKNOWN') as WhatsAppStatus,
        instagramUrl: lead.digitalPresence?.instagramUrl ?? null,
        facebookUrl: lead.digitalPresence?.facebookUrl ?? null,
      },

      score: {
        value: lead.score?.value ?? 0,
        level: (lead.score?.level ?? 'BAIXA') as ScoreLevelName,
        algorithmVersion: lead.score?.algorithmVersion ?? 'score-v1',
        calculatedAt: (lead.score?.calculatedAt ?? lead.createdAt).toISOString(),
        positives: reasons
          .filter((reason) => reason.polarity === 'POSITIVE')
          .map(this.toReasonView),
        attentions: reasons
          .filter((reason) => reason.polarity !== 'POSITIVE')
          .map(this.toReasonView),
        disqualified: lead.isDisqualified,
      },

      pipeline: {
        stages: stages.map((stage) => ({
          id: stage.id,
          slug: stage.slug,
          name: stage.name,
          color: stage.color,
          order: stage.order,
          isTerminal: stage.isTerminal,
        })),
        currentStageId: lead.pipelineCard?.stageId ?? null,
        currentStageSlug: lead.pipelineCard?.stage.slug ?? null,
        ownerName: lead.pipelineCard?.owner?.name ?? null,
        enteredStageAt: lead.pipelineCard?.enteredStageAt.toISOString() ?? null,
      },

      tracking: {
        lastActivityAt: lead.activities[0]?.createdAt.toISOString() ?? null,
        nextFollowUpAt: nextFollowUp?.dueAt.toISOString() ?? null,
        lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
        lastEnrichedAt: lead.lastEnrichedAt?.toISOString() ?? null,
      },

      notes: lead.notes.map((note) => ({
        id: note.id,
        content: note.content,
        authorName: note.author?.name ?? null,
        createdAt: note.createdAt.toISOString(),
      })),

      contactRecords: lead.contactRecords.map((record) => ({
        id: record.id,
        channel: record.channel,
        direction: record.direction,
        outcome: record.outcome,
        notes: record.notes,
        authorName: record.author?.name ?? null,
        occurredAt: record.occurredAt.toISOString(),
      })),

      followUps: lead.followUps.map((item) => ({
        id: item.id,
        channel: item.channel,
        priority: item.priority,
        status: item.status,
        dueAt: item.dueAt.toISOString(),
        notes: item.notes,
        ownerName: item.owner?.name ?? null,
      })),

      activities: lead.activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        actorName: activity.actor?.name ?? null,
        createdAt: activity.createdAt.toISOString(),
      })),

      isFavorite: lead.isFavorite,
      isDisqualified: lead.isDisqualified,
      isDemo: lead.isDemo,
      createdAt: lead.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------------------

  async toggleFavorite(
    tenantId: string,
    leadId: string,
    userId: string,
    favorite: boolean,
  ): Promise<{ isFavorite: boolean }> {
    await this.assertLead(tenantId, leadId);

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { isFavorite: favorite },
    });

    await this.recordActivity(
      tenantId,
      leadId,
      userId,
      favorite ? 'FAVORITED' : 'UNFAVORITED',
    );

    return { isFavorite: favorite };
  }

  async changeStage(
    tenantId: string,
    leadId: string,
    userId: string,
    stageSlug: string,
    reason?: string,
  ): Promise<{ stageSlug: string }> {
    await this.assertLead(tenantId, leadId);

    const stage = await this.prisma.pipelineStage.findUnique({
      where: { tenantId_slug: { tenantId, slug: stageSlug } },
    });
    if (!stage) throw new NotFoundException('Etapa não encontrada');

    const card = await this.prisma.pipelineCard.findUnique({ where: { leadId } });
    const fromStageId = card?.stageId ?? null;

    const updated = card
      ? await this.prisma.pipelineCard.update({
          where: { leadId },
          data: {
            stageId: stage.id,
            enteredStageAt: new Date(),
            lostReason: stage.slug === 'perdido' ? (reason ?? null) : null,
          },
        })
      : await this.prisma.pipelineCard.create({
          data: { tenantId, leadId, stageId: stage.id, ownerId: userId },
        });

    // Histórico de movimentação: quem moveu, de onde, para onde e por quê.
    await this.prisma.pipelineTransition.create({
      data: {
        tenantId,
        cardId: updated.id,
        fromStageId,
        toStageId: stage.id,
        changedById: userId,
        origin: 'lead-detail',
        reason: reason ?? null,
      },
    });

    await this.recordActivity(tenantId, leadId, userId, 'STAGE_CHANGED', {
      to: stage.slug,
    });

    return { stageSlug: stage.slug };
  }

  async addNote(tenantId: string, leadId: string, userId: string, content: string) {
    await this.assertLead(tenantId, leadId);

    // Nota nunca é sobrescrita: correção vira registro novo.
    const note = await this.prisma.leadNote.create({
      data: { tenantId, leadId, authorId: userId, content },
      include: { author: true },
    });

    await this.recordActivity(tenantId, leadId, userId, 'NOTE_ADDED');

    return {
      id: note.id,
      content: note.content,
      authorName: note.author?.name ?? null,
      createdAt: note.createdAt.toISOString(),
    };
  }

  async addContactRecord(
    tenantId: string,
    leadId: string,
    userId: string,
    input: {
      channel: string;
      direction: 'SENT' | 'RECEIVED';
      outcome?: string;
      notes?: string;
    },
  ) {
    await this.assertLead(tenantId, leadId);

    const record = await this.prisma.leadContactRecord.create({
      data: {
        tenantId,
        leadId,
        authorId: userId,
        channel: input.channel as never,
        direction: input.direction,
        outcome: input.outcome ?? null,
        notes: input.notes ?? null,
      },
      include: { author: true },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { lastContactedAt: new Date() },
    });

    await this.recordActivity(tenantId, leadId, userId, 'CONTACT_REGISTERED');

    return {
      id: record.id,
      channel: record.channel,
      direction: record.direction,
      outcome: record.outcome,
      notes: record.notes,
      authorName: record.author?.name ?? null,
      occurredAt: record.occurredAt.toISOString(),
    };
  }

  async addFollowUp(
    tenantId: string,
    leadId: string,
    userId: string,
    input: { dueAt: string; channel?: string; priority?: string; notes?: string },
  ) {
    await this.assertLead(tenantId, leadId);

    const dueAt = new Date(input.dueAt);
    const followUp = await this.prisma.leadFollowUp.create({
      data: {
        tenantId,
        leadId,
        ownerId: userId,
        dueAt,
        channel: (input.channel ?? 'WHATSAPP') as never,
        priority: (input.priority ?? 'MEDIUM') as never,
        status: dueAt < new Date() ? 'OVERDUE' : 'PENDING',
        notes: input.notes ?? null,
      },
      include: { owner: true },
    });

    await this.recordActivity(tenantId, leadId, userId, 'FOLLOWUP_CREATED');

    return {
      id: followUp.id,
      channel: followUp.channel,
      priority: followUp.priority,
      status: followUp.status,
      dueAt: followUp.dueAt.toISOString(),
      notes: followUp.notes,
      ownerName: followUp.owner?.name ?? null,
    };
  }

  /**
   * Conclui, cancela ou reagenda um follow-up.
   *
   * Reagendar reabre: data nova sem status explícito devolve o item a PENDING
   * (ou OVERDUE, se a data já passou) e limpa as marcas de conclusão e
   * cancelamento. Sem isso, remarcar um follow-up cancelado deixaria um item
   * com data futura e status CANCELLED — visível na lista, invisível nos
   * avisos, e ninguém entenderia por quê.
   */
  async updateFollowUp(
    tenantId: string,
    leadId: string,
    followUpId: string,
    userId: string,
    input: { status?: 'PENDING' | 'COMPLETED' | 'CANCELLED'; dueAt?: string; notes?: string },
  ) {
    await this.assertLead(tenantId, leadId);

    // Escopo por tenant e por lead: id de follow-up conhecido não basta.
    const existing = await this.prisma.leadFollowUp.findFirst({
      where: { id: followUpId, tenantId, leadId },
    });
    if (!existing) throw new NotFoundException('Follow-up não encontrado');

    const dueAt = input.dueAt ? new Date(input.dueAt) : existing.dueAt;
    const reopening = Boolean(input.dueAt) && !input.status;

    const status = input.status ?? (reopening ? undefined : existing.status);
    const resolvedStatus =
      status ?? (dueAt < new Date() ? 'OVERDUE' : 'PENDING');

    const followUp = await this.prisma.leadFollowUp.update({
      where: { id: followUpId },
      data: {
        dueAt,
        status: resolvedStatus as never,
        notes: input.notes ?? existing.notes,
        completedAt: resolvedStatus === 'COMPLETED' ? new Date() : null,
        cancelledAt: resolvedStatus === 'CANCELLED' ? new Date() : null,
      },
      include: { owner: true },
    });

    if (resolvedStatus === 'COMPLETED') {
      await this.recordActivity(tenantId, leadId, userId, 'FOLLOWUP_COMPLETED');
    }

    return {
      id: followUp.id,
      channel: followUp.channel,
      priority: followUp.priority,
      status: followUp.status,
      dueAt: followUp.dueAt.toISOString(),
      notes: followUp.notes,
      ownerName: followUp.owner?.name ?? null,
    };
  }

  /** Recalcula com o mesmo motor usado pelo worker e pelo seed. */
  async recalculateScore(tenantId: string, leadId: string, userId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null },
      include: { digitalPresence: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const onboarding = await this.prisma.onboardingState.findUnique({
      where: { tenantId },
    });

    const niches = (onboarding?.targetNiches as string[] | null) ?? [];
    const regions = (onboarding?.targetRegions as string[] | null) ?? [];

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
      isPriorityNiche: niches.some((niche) =>
        niche.toLowerCase().startsWith((lead.category ?? '').toLowerCase().slice(0, 6)),
      ),
      isServedRegion: regions.some((region) =>
        region.toLowerCase().startsWith((lead.addressCity ?? '').toLowerCase()),
      ),
      lastContactedAt: lead.lastContactedAt,
      lastEnrichedAt: lead.lastEnrichedAt,
      isSuppressed: Boolean(lead.suppressedAt),
      isPermanentlyClosed: false,
    };

    const result = computeScore(input);

    const score = await this.prisma.leadScore.upsert({
      where: { leadId },
      create: {
        tenantId,
        leadId,
        value: result.value,
        level: result.level,
        algorithmVersion: result.algorithmVersion,
      },
      update: {
        value: result.value,
        level: result.level,
        algorithmVersion: result.algorithmVersion,
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

    await this.recordActivity(tenantId, leadId, userId, 'SCORE_RECALCULATED', {
      value: result.value,
    });

    return { value: result.value, level: result.level };
  }

  /** Copiar telefone, abrir mapa e abrir WhatsApp geram trilha. */
  async registerActivity(
    tenantId: string,
    leadId: string,
    userId: string,
    type: string,
  ): Promise<void> {
    await this.assertLead(tenantId, leadId);
    await this.recordActivity(tenantId, leadId, userId, type);
  }

  // ---------------------------------------------------------------------------

  /**
   * Exportação CSV da listagem.
   *
   * Respeita os filtros ativos, e não a base inteira: quem filtrou 40 leads de
   * score alto quer esses 40. Exportar tudo obrigaria a pessoa a refazer o
   * recorte na planilha, que é justamente o trabalho que a tela já fez.
   *
   * Sem paginação — `page` e `pageSize` são ignorados de propósito. Exportar
   * só a página visível seria surpresa desagradável, e o teto de segurança
   * fica em EXPORT_MAX_ROWS.
   *
   * O gate é verificado aqui, na tentativa. Nunca no carregamento da tela.
   */
  async exportCsv(
    tenantId: string,
    planCode: PlanCode,
    userId: string,
    query: LeadQueryDto,
  ): Promise<{ filename: string; content: string; rows: number }> {
    this.entitlements.assert(planCode, 'export.csv');

    const where = this.buildWhere(tenantId, query);

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { score: { value: 'desc' } },
      take: EXPORT_MAX_ROWS,
      include: {
        score: true,
        digitalPresence: true,
        pipelineCard: { include: { stage: true } },
      },
    });

    const maskPhones = !this.entitlements.can(planCode, 'phone.full');

    const linhas = leads.map((lead) => [
      lead.name,
      lead.category ?? '',
      lead.addressCity ?? '',
      lead.addressStateUf ?? '',
      maskPhones
        ? (this.entitlements.maskPhone(lead.phoneRaw, planCode) ?? '')
        : (lead.phoneRaw ?? ''),
      lead.email ?? '',
      lead.website ?? '',
      WEBSITE_STATUS_LABEL[lead.websiteStatus] ?? lead.websiteStatus,
      WHATSAPP_STATUS_LABEL[lead.digitalPresence?.whatsappStatus ?? 'UNKNOWN'] ??
        'Não verificado',
      lead.score ? String(lead.score.value) : '',
      lead.pipelineCard?.stage?.name ?? '',
      lead.createdAt.toISOString().slice(0, 10),
    ]);

    const cabecalho = [
      'Empresa',
      'Categoria',
      'Cidade',
      'UF',
      'Telefone',
      'E-mail',
      'Website',
      'Situação do site',
      'WhatsApp',
      'Score',
      'Etapa',
      'Descoberto em',
    ];

    // BOM + separador ponto e vírgula.
    //
    // O Excel em português abre CSV assumindo `;` e latin-1. Sem o BOM, acento
    // vira caractere quebrado; com vírgula, tudo cai numa coluna só. Os dois
    // detalhes decidem se o arquivo é útil ou se a pessoa desiste na primeira
    // tentativa — e o público deste produto abre planilha no Excel, não no pandas.
    const conteudo =
      '﻿' +
      [cabecalho, ...linhas].map((linha) => linha.map(csvCampo).join(';')).join('\r\n');

    await this.entitlements.currentUsage(tenantId);
    await this.prisma.planUsage.updateMany({
      where: { tenantId },
      data: { exportsCount: { increment: 1 } },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorId: userId,
        action: 'leads.exported',
        entityType: 'Lead',
        entityId: null,
        after: { rows: leads.length, filtros: { ...query } } as unknown as object,
      },
    });

    const carimbo = new Date().toISOString().slice(0, 10);

    return {
      filename: `leads-${carimbo}.csv`,
      content: conteudo,
      rows: leads.length,
    };
  }

  private buildWhere(tenantId: string, query: LeadQueryDto): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = { tenantId, deletedAt: null };

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.stateUf) where.addressStateUf = query.stateUf;
    if (query.city) where.addressCity = query.city;
    if (query.category) where.category = query.category;
    if (query.favoritesOnly) where.isFavorite = true;
    if (query.withoutOwnWebsite) {
      where.websiteStatus = { in: OPEN_WEBSITE_STATUSES };
    }
    if (query.likelyWhatsapp) {
      where.digitalPresence = { whatsappStatus: { in: ['LIKELY', 'VERIFIED'] } };
    }
    if (query.minScore !== undefined) {
      where.score = { value: { gte: query.minScore } };
    }
    if (query.stageSlug) {
      where.pipelineCard = { stage: { slug: query.stageSlug } };
    }

    return where;
  }

  private async assertLead(tenantId: string, leadId: string): Promise<void> {
    const exists = await this.prisma.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Lead não encontrado');
  }

  private async recordActivity(
    tenantId: string,
    leadId: string,
    userId: string,
    type: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.leadActivity.create({
      data: {
        tenantId,
        leadId,
        actorId: userId,
        type: type as never,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private toReasonView(reason: {
    code: string;
    label: string;
    weight: number;
    polarity: string;
    evidence: string | null;
  }) {
    return {
      code: reason.code,
      label: reason.label,
      weight: reason.weight,
      polarity: reason.polarity as 'POSITIVE' | 'NEGATIVE' | 'DISQUALIFYING',
      evidence: reason.evidence,
    };
  }
}
