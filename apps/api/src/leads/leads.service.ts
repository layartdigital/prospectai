import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeScore,
  type LeadDetail,
  type LeadFacets,
  type LeadListResponse,
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

/**
 * ## O hub, e as duas ajudantes que decidem a forma do arquivo
 *
 * Este é o arquivo com mais acessos ao banco do projeto — 33 —, e por isso é o
 * último da fase A entre os da API: o padrão já foi repetido cinco vezes antes
 * de chegar aqui.
 *
 * A conversão não é um embrulho por método. Quase todo método público chama
 * duas privadas — `assertLead` e `recordActivity` — e **as duas abriam consulta
 * própria**. Deixá-las assim significaria que uma ação como `addNote` faria
 * três transações separadas: uma para conferir o lead, uma para gravar a nota,
 * uma para registrar a atividade. Com política ligada as três funcionariam; o
 * que não funcionaria é a atomicidade — nota gravada e atividade perdida.
 *
 * Então as duas passaram a **receber o `tx`**. É a mesma forma de
 * `assertNaoEUltimoDono` no `team`, `lerPreferencias` no `account` e
 * `ajustarAcesso` no `billing`. O tipo do parâmetro é quem diz que elas só
 * vivem dentro de um bloco.
 *
 * **Este é o terceiro e último módulo que escreve nas tabelas do Pipeline.** Os
 * outros dois — `pipeline.service.ts` e `proposals.service.ts` — já estão
 * convertidos. Com `changeStage` aqui dentro de bloco, a família Pipeline
 * volta a ser religável: foi a falta desses dois que derrubou 45 testes em
 * 27/08.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listagem
  // ---------------------------------------------------------------------------

  /**
   * O `Promise.all` continua escrito, e agora ele é honesto ao contrário.
   *
   * Dentro de uma transação interativa do Prisma tudo corre numa conexão só, e
   * as cinco consultas são serializadas. Medido: 12 consultas soltas 13,3 ms,
   * as mesmas 12 num bloco 37,4 ms, em doze blocos independentes 52,1 ms.
   *
   * **Um bloco ainda ganha** — mas pelo motivo oposto ao que eu supunha: não
   * porque a serialização seja barata, e sim porque transações concorrentes
   * custam mais e ainda disputam o pool. Esta é a rota mais quente do produto,
   * e o custo é real: some da ordem de milissegundos de dois dígitos. É o preço
   * do isolamento, e está medido em vez de suposto.
   */
  async list(
    tenantId: string,
    planCode: string,
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
      await this.prisma.comTenant(tenantId, (tx) =>
        Promise.all([
          tx.lead.findMany({
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
          tx.lead.count({ where }),
          tx.lead.count({
            where: { ...where, websiteStatus: { in: OPEN_WEBSITE_STATUSES } },
          }),
          tx.lead.count({
            where: {
              ...where,
              digitalPresence: { whatsappStatus: { in: ['LIKELY', 'VERIFIED'] } },
            },
          }),
          tx.lead.count({ where: { ...where, score: { value: { gte: 70 } } } }),
        ]),
      );

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
    const [states, cities, categories, stages] = await this.prisma.comTenant(
      tenantId,
      (tx) =>
        Promise.all([
          tx.lead.findMany({
            where: { tenantId, deletedAt: null, addressStateUf: { not: null } },
            distinct: ['addressStateUf'],
            select: { addressStateUf: true },
            orderBy: { addressStateUf: 'asc' },
          }),
          tx.lead.findMany({
            where: { tenantId, deletedAt: null, addressCity: { not: null } },
            distinct: ['addressCity'],
            select: { addressCity: true },
            orderBy: { addressCity: 'asc' },
          }),
          tx.lead.findMany({
            where: { tenantId, deletedAt: null, category: { not: null } },
            distinct: ['category'],
            select: { category: true },
            orderBy: { category: 'asc' },
          }),
          tx.pipelineStage.findMany({
            where: { tenantId },
            orderBy: { order: 'asc' },
          }),
        ]),
    );

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

  /**
   * A consulta que mais depende do contexto no produto inteiro.
   *
   * O `include` desce por `score` → `reasons`, `digitalPresence`,
   * `pipelineCard` → `stage`, `notes`, `contactRecords`, `followUps` e
   * `activities`. **Todas essas tabelas têm `tenantId`**; só `author`, `owner`
   * e `actor` (que são `User`) não têm. Com política ligada e sem contexto
   * declarado, esta única chamada devolve o lead com sete listas vazias — e a
   * tela de detalhe abre parecendo um lead que nunca teve histórico, em vez de
   * dar erro. É o tipo de falha que passa despercebida em produção.
   */
  async findOne(
    tenantId: string,
    leadId: string,
    planCode: string,
  ): Promise<LeadDetail> {
    const { lead, stages } = await this.prisma.comTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
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

      const stages = await tx.pipelineStage.findMany({
        where: { tenantId },
        orderBy: { order: 'asc' },
      });

      return { lead, stages };
    });

    // 404 e não 403: confirmar que o recurso existe em outro tenant já é
    // vazamento de informação.
    if (!lead) throw new NotFoundException('Lead não encontrado');

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
    await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      await tx.lead.update({
        where: { id: leadId },
        data: { isFavorite: favorite },
      });

      await this.recordActivity(
        tx,
        tenantId,
        leadId,
        userId,
        favorite ? 'FAVORITED' : 'UNFAVORITED',
      );
    });

    return { isFavorite: favorite };
  }

  /**
   * Move o card no funil.
   *
   * Seis chamadas, e as três últimas são nas tabelas do Pipeline. Num bloco só
   * por dois motivos que se somam: a política vai exigir contexto nas três, e
   * a atomicidade estava faltando. Antes, uma falha ao gravar a transição
   * deixava o card na etapa nova **sem registro de quem o moveu** — o histórico
   * de movimentação com um buraco é pior do que não ter histórico, porque
   * parece completo.
   */
  async changeStage(
    tenantId: string,
    leadId: string,
    userId: string,
    stageSlug: string,
    reason?: string,
  ): Promise<{ stageSlug: string }> {
    const slug = await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      const stage = await tx.pipelineStage.findUnique({
        where: { tenantId_slug: { tenantId, slug: stageSlug } },
      });
      if (!stage) throw new NotFoundException('Etapa não encontrada');

      const card = await tx.pipelineCard.findUnique({ where: { leadId } });
      const fromStageId = card?.stageId ?? null;

      const updated = card
        ? await tx.pipelineCard.update({
            where: { leadId },
            data: {
              stageId: stage.id,
              enteredStageAt: new Date(),
              lostReason: stage.slug === 'perdido' ? (reason ?? null) : null,
            },
          })
        : await tx.pipelineCard.create({
            data: { tenantId, leadId, stageId: stage.id, ownerId: userId },
          });

      // Histórico de movimentação: quem moveu, de onde, para onde e por quê.
      await tx.pipelineTransition.create({
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

      await this.recordActivity(tx, tenantId, leadId, userId, 'STAGE_CHANGED', {
        to: stage.slug,
      });

      return stage.slug;
    });

    return { stageSlug: slug };
  }

  async addNote(tenantId: string, leadId: string, userId: string, content: string) {
    const note = await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      // Nota nunca é sobrescrita: correção vira registro novo.
      const note = await tx.leadNote.create({
        data: { tenantId, leadId, authorId: userId, content },
        include: { author: true },
      });

      await this.recordActivity(tx, tenantId, leadId, userId, 'NOTE_ADDED');

      return note;
    });

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
    const record = await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      const record = await tx.leadContactRecord.create({
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

      await tx.lead.update({
        where: { id: leadId },
        data: { lastContactedAt: new Date() },
      });

      await this.recordActivity(tx, tenantId, leadId, userId, 'CONTACT_REGISTERED');

      return record;
    });

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
    const dueAt = new Date(input.dueAt);

    const followUp = await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      const followUp = await tx.leadFollowUp.create({
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

      await this.recordActivity(tx, tenantId, leadId, userId, 'FOLLOWUP_CREATED');

      return followUp;
    });

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
    const followUp = await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);

      // Escopo por tenant e por lead: id de follow-up conhecido não basta.
      const existing = await tx.leadFollowUp.findFirst({
        where: { id: followUpId, tenantId, leadId },
      });
      if (!existing) throw new NotFoundException('Follow-up não encontrado');

      const dueAt = input.dueAt ? new Date(input.dueAt) : existing.dueAt;
      const reopening = Boolean(input.dueAt) && !input.status;

      const status = input.status ?? (reopening ? undefined : existing.status);
      const resolvedStatus =
        status ?? (dueAt < new Date() ? 'OVERDUE' : 'PENDING');

      const followUp = await tx.leadFollowUp.update({
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
        await this.recordActivity(tx, tenantId, leadId, userId, 'FOLLOWUP_COMPLETED');
      }

      return followUp;
    });

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
   * Recalcula com o mesmo motor usado pelo worker e pelo seed.
   *
   * **O bloco conserta um defeito que já existia aqui.** As razões do score são
   * apagadas e recriadas: `deleteMany` seguido de `createMany`. Soltas, uma
   * falha entre as duas deixava o lead com score e **nenhuma razão** — a tela
   * mostraria um número sem explicação, e nada indicaria que faltava algo.
   * Agora as duas vivem ou morrem juntas.
   *
   * **Um bloco, e não dois.** Cheguei a separar leitura e escrita para deixar o
   * `computeScore` fora — e o cálculo é puro, sobre dados já lidos. Mas ele
   * custa microssegundos e uma segunda transação custa ~5 ms medidos: o corte
   * pagaria cinco mil vezes o que economiza, e ainda desfaria a atomicidade
   * entre ler o lead e gravar o score dele. É o mesmo tipo de escolha por
   * raciocínio em vez de medida que já me custou duas vezes neste plano.
   *
   * O `exportCsv` faz o corte oposto pela razão oposta: lá o trabalho entre as
   * pontas é montar cinco mil linhas de texto, que é milissegundos de verdade.
   */
  async recalculateScore(tenantId: string, leadId: string, userId: string) {
    const result = await this.prisma.comTenant(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, tenantId, deletedAt: null },
        include: { digitalPresence: true },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado');

      const onboarding = await tx.onboardingState.findUnique({ where: { tenantId } });

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

      const score = await tx.leadScore.upsert({
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

      await this.recordActivity(tx, tenantId, leadId, userId, 'SCORE_RECALCULATED', {
        value: result.value,
      });

      return result;
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
    await this.prisma.comTenant(tenantId, async (tx) => {
      await this.assertLead(tx, tenantId, leadId);
      await this.recordActivity(tx, tenantId, leadId, userId, type);
    });
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
   *
   * **Dois blocos, com a montagem do CSV entre eles.** A regra do `comTenant`
   * fala em I/O externo, e aqui não há nenhum — mas o espírito é o mesmo: não
   * segurar conexão durante trabalho que não é consulta. Montar cinco mil
   * linhas de texto é trabalho síncrono de CPU que bloqueia o event loop, e
   * fazê-lo com a transação aberta prenderia a conexão pelo caminho todo.
   */
  async exportCsv(
    tenantId: string,
    planCode: string,
    userId: string,
    query: LeadQueryDto,
  ): Promise<{ filename: string; content: string; rows: number }> {
    this.entitlements.assert(planCode, 'export.csv');

    const where = this.buildWhere(tenantId, query);

    const leads = await this.prisma.comTenant(tenantId, (tx) =>
      tx.lead.findMany({
        where,
        orderBy: { score: { value: 'desc' } },
        take: EXPORT_MAX_ROWS,
        include: {
          score: true,
          digitalPresence: true,
          pipelineCard: { include: { stage: true } },
        },
      }),
    );

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

    await this.prisma.comTenant(tenantId, async (tx) => {
      /**
       * Garante que a linha de uso do período exista antes do `updateMany`.
       *
       * O retorno é descartado de propósito — o que interessa é o efeito.
       *
       * **Passou para dentro do bloco na fatia 8**, quando o `currentUsage`
       * ganhou o `tx` opcional. Antes eram duas transações: uma para criar a
       * linha, outra para incrementar. Agora criar e incrementar são o mesmo
       * fato, e uma exportação registrada é uma exportação contada.
       */
      await this.entitlements.currentUsage(tenantId, tx);

      await tx.planUsage.updateMany({
        where: { tenantId },
        data: { exportsCount: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: userId,
          action: 'leads.exported',
          entityType: 'Lead',
          entityId: null,
          after: { rows: leads.length, filtros: { ...query } } as unknown as object,
        },
      });
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

  /**
   * Recebe o `tx`, e o tipo é quem diz por quê.
   *
   * Antes abria consulta própria. Chamada de nove métodos, ela sozinha
   * transformava cada ação em duas transações — a conferência numa, a escrita
   * noutra —, e o `NotFoundException` que ela lança precisa abortar a mesma
   * transação onde a escrita aconteceria. `Prisma.TransactionClient` no
   * parâmetro impede que ela volte a ser chamada solta.
   */
  private async assertLead(
    tx: Prisma.TransactionClient,
    tenantId: string,
    leadId: string,
  ): Promise<void> {
    const exists = await tx.lead.findFirst({
      where: { id: leadId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Lead não encontrado');
  }

  /** Mesma razão do `assertLead`: a trilha pertence à transação da ação. */
  private async recordActivity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    leadId: string,
    userId: string,
    type: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await tx.leadActivity.create({
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
