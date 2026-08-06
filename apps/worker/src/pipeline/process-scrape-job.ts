import { createHash } from 'node:crypto';

import { PrismaClient, type Prisma } from '@prisma/client';
import {
  classifyWebsite,
  computeScore,
  fingerprintInput,
  toE164BR,
  toStateUf,
  whatsappStatusFromPhone,
  type LeadSourceProvider,
  type RawLead,
  type ScoreInput,
} from '@propectai/types';

import { logger } from '../logger';

export interface ScrapeJobPayload {
  tenantId: string;
  searchId: string;
  scrapeJobId: string;
  keyword: string;
  requestedCount: number;
  radiusKm: number;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // 6 minutos, um pouco acima do teto de 300s do scraper

function fingerprint(name: string, phoneE164: string | null, postal: string | null): string {
  return createHash('sha256')
    .update(fingerprintInput(name, phoneE164, postal))
    .digest('hex');
}

/**
 * Ciclo completo de uma busca.
 *
 *   RUNNING -> NORMALIZING -> SCORING -> COMPLETED
 *
 * Regras que não podem ser quebradas:
 *   - Dados pessoais de terceiros nunca são gravados
 *   - Lead duplicado não consome cota
 *   - Job que falha devolve toda a reserva
 *   - Nenhum lead fica visível antes do score terminar
 */
export async function processScrapeJob(
  prisma: PrismaClient,
  provider: LeadSourceProvider,
  payload: ScrapeJobPayload,
): Promise<{ newLeads: number; duplicates: number }> {
  const startedAt = Date.now();
  const { tenantId, searchId, scrapeJobId, keyword, requestedCount } = payload;

  const setStatus = async (
    status: string,
    data: Prisma.ScrapeJobUpdateInput = {},
  ): Promise<void> => {
    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: { status: status as never, ...data },
    });
  };

  try {
    // ---- 1. Consulta à fonte ------------------------------------------------
    await setStatus('RUNNING', { startedAt: new Date(), attempts: { increment: 1 } });

    const search = await prisma.prospectingSearch.findUniqueOrThrow({
      where: { id: searchId },
    });

    const sourceJob = await provider.createSearch({
      keyword,
      lang: 'pt',
      radiusKm: search.radiusKm,
      maxDepth: Math.max(1, Math.ceil(requestedCount / 20)),
      extractEmail: true,
    });

    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: { externalJobId: sourceJob.externalJobId },
    });

    // ---- 2. Acompanhamento --------------------------------------------------
    let polls = 0;
    let status = sourceJob.status;

    while (status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELLED') {
      if (polls >= MAX_POLLS) {
        throw new Error('A fonte não respondeu dentro do tempo limite');
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = await provider.getJob(sourceJob.externalJobId);
      status = current.status;
      polls += 1;
    }

    if (status !== 'COMPLETED') {
      throw new Error(`A fonte terminou com estado ${status}`);
    }

    // ---- 3. Normalização e deduplicação ------------------------------------
    await setStatus('NORMALIZING');

    const rawLeads = (await provider.getResults(sourceJob.externalJobId)).slice(
      0,
      requestedCount,
    );

    const onboarding = await prisma.onboardingState.findUnique({ where: { tenantId } });
    const niches = ((onboarding?.targetNiches as string[] | null) ?? []).map((n) =>
      n.toLowerCase(),
    );
    const regions = ((onboarding?.targetRegions as string[] | null) ?? []).map((r) =>
      r.toLowerCase(),
    );

    const createdLeadIds: string[] = [];
    let duplicates = 0;

    for (const raw of rawLeads) {
      const result = await upsertLead(prisma, {
        tenantId,
        searchId,
        scrapeJobId,
        raw,
      });

      if (result.isNew) createdLeadIds.push(result.leadId);
      else duplicates += 1;
    }

    // ---- 4. Score -----------------------------------------------------------
    await setStatus('SCORING');

    for (const leadId of createdLeadIds) {
      await scoreLead(prisma, tenantId, leadId, niches, regions);
    }

    // ---- 5. Liquidação da cota ---------------------------------------------
    // Reserva vira consumo apenas pelo número de leads NOVOS. O que sobrou
    // da reserva volta para o saldo — duplicado não custa nada ao cliente.
    await settleQuota(prisma, tenantId, requestedCount, createdLeadIds.length);

    const durationMs = Date.now() - startedAt;

    await prisma.prospectingSearch.update({
      where: { id: searchId },
      data: { leadsFound: createdLeadIds.length, duplicatesFound: duplicates },
    });

    await setStatus('COMPLETED', {
      finishedAt: new Date(),
      durationMs,
      resultCount: rawLeads.length,
      newLeadCount: createdLeadIds.length,
      duplicateCount: duplicates,
    });

    await prisma.notification.create({
      data: {
        tenantId,
        type: 'SEARCH_COMPLETED',
        title: 'Busca concluída',
        body: `${keyword}: ${createdLeadIds.length} leads novos, ${duplicates} duplicados.`,
        payload: { searchId },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: 'prospecting.job.completed',
        entityType: 'ScrapeJob',
        entityId: scrapeJobId,
        after: { newLeads: createdLeadIds.length, duplicates, durationMs },
      },
    });

    return { newLeads: createdLeadIds.length, duplicates };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ scrapeJobId, error: message }, 'Job de coleta falhou');

    // Devolve toda a reserva: o cliente não paga por busca que não entregou.
    await refundQuota(prisma, tenantId, requestedCount);

    await setStatus('FAILED', {
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      errorCode: 'SOURCE_ERROR',
      errorMessage: message,
    });

    await prisma.notification.create({
      data: {
        tenantId,
        type: 'SEARCH_FAILED',
        title: 'Busca não concluída',
        body: `${keyword}: ${message}. Os créditos foram devolvidos.`,
        payload: { searchId },
      },
    });

    throw error;
  }
}

// =============================================================================

async function upsertLead(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    searchId: string;
    scrapeJobId: string;
    raw: RawLead;
  },
): Promise<{ leadId: string; isNew: boolean }> {
  const { tenantId, searchId, scrapeJobId, raw } = input;

  const phoneE164 = toE164BR(raw.phone);
  const stateUf = toStateUf(raw.stateName);
  const website = classifyWebsite(raw.website);
  const fp = fingerprint(raw.title, phoneE164, raw.postalCode);

  // Deduplicação: placeId primeiro, fingerprint depois.
  const existing = await prisma.lead.findFirst({
    where: {
      tenantId,
      OR: [
        ...(raw.placeId ? [{ placeId: raw.placeId }] : []),
        { fingerprint: fp },
      ],
    },
  });

  if (existing) {
    // Duplicado atualiza os dados — informação mais fresca é ganho — mas
    // não conta como lead novo e não consome cota.
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        phoneRaw: raw.phone ?? existing.phoneRaw,
        phoneE164: phoneE164 ?? existing.phoneE164,
        email: raw.email ?? existing.email,
        website: raw.website ?? existing.website,
        websiteStatus: website.status,
        reviewCount: raw.reviewCount ?? existing.reviewCount,
        reviewRating: raw.reviewRating ?? existing.reviewRating,
        lastEnrichedAt: new Date(),
      },
    });

    return { leadId: existing.id, isNew: false };
  }

  const lead = await prisma.lead.create({
    data: {
      tenantId,
      searchId,
      name: raw.title,
      category: raw.category,
      phoneRaw: raw.phone,
      phoneE164,
      email: raw.email,
      website: raw.website,
      websiteStatus: website.status,
      addressStreet: raw.street,
      addressNeighborhood: raw.neighborhood,
      addressCity: raw.city,
      addressStateUf: stateUf,
      addressPostalCode: raw.postalCode,
      addressFull: raw.addressFull,
      latitude: raw.latitude,
      longitude: raw.longitude,
      reviewCount: raw.reviewCount,
      reviewRating: raw.reviewRating,
      openHours: (raw.openHours ?? undefined) as Prisma.InputJsonValue | undefined,
      timezone: raw.timezone,
      source: 'GOOGLE_MAPS',
      placeId: raw.placeId,
      cid: raw.cid,
      sourceUrl: raw.sourceUrl,
      fingerprint: fp,
      lastEnrichedAt: new Date(),
    },
  });

  // Payload bruto já higienizado: o RawLead nunca carregou user_reviews
  // nem o perfil do proprietário — o provider descarta na origem.
  await prisma.leadSourceRecord.create({
    data: {
      tenantId,
      leadId: lead.id,
      scrapeJobId,
      source: 'GOOGLE_MAPS',
      sourceId: raw.placeId,
      payload: raw as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.leadDigitalPresence.create({
    data: {
      tenantId,
      leadId: lead.id,
      hasWebsite: website.status === 'SEM_SITE' ? 'AUSENTE' : 'PRESENTE',
      hasEmail: raw.email ? 'PRESENTE' : 'DESCONHECIDO',
      hasPhone: phoneE164 ? 'PRESENTE' : 'AUSENTE',
      // O scraper não entrega redes sociais e não houve enriquecimento.
      // DESCONHECIDO, nunca AUSENTE.
      hasInstagram: 'DESCONHECIDO',
      hasFacebook: 'DESCONHECIDO',
      hasReviews: (raw.reviewCount ?? 0) > 0 ? 'PRESENTE' : 'AUSENTE',
      whatsappStatus: whatsappStatusFromPhone(raw.phone),
      websiteHasHttps: website.hasHttps,
      lastCheckedAt: new Date(),
    },
  });

  return { leadId: lead.id, isNew: true };
}

async function scoreLead(
  prisma: PrismaClient,
  tenantId: string,
  leadId: string,
  niches: string[],
  regions: string[],
): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { digitalPresence: true },
  });

  const category = (lead.category ?? '').toLowerCase();
  const city = (lead.addressCity ?? '').toLowerCase();

  const scoreInput: ScoreInput = {
    websiteStatus: lead.websiteStatus,
    websiteHasHttps: lead.digitalPresence?.websiteHasHttps ?? null,
    hasPhone: Boolean(lead.phoneE164),
    whatsappStatus: lead.digitalPresence?.whatsappStatus ?? 'UNKNOWN',
    email: lead.email,
    reviewCount: lead.reviewCount,
    reviewRating: lead.reviewRating,
    hasOpenHours: Boolean(lead.openHours),
    hasCompleteAddress: Boolean(lead.addressPostalCode),
    isPriorityNiche: niches.some(
      (niche) => niche.startsWith(category.slice(0, 6)) && category.length > 3,
    ),
    isServedRegion: regions.some((region) => region.startsWith(city) && city.length > 2),
    lastContactedAt: lead.lastContactedAt,
    lastEnrichedAt: lead.lastEnrichedAt,
    isSuppressed: Boolean(lead.suppressedAt),
    isPermanentlyClosed: false,
  };

  const result = computeScore(scoreInput);

  const score = await prisma.leadScore.upsert({
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
      calculatedAt: new Date(),
    },
  });

  await prisma.leadScoreReason.deleteMany({ where: { scoreId: score.id } });
  await prisma.leadScoreReason.createMany({
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

  if (result.value >= 85) {
    await prisma.notification.create({
      data: {
        tenantId,
        type: 'HIGH_SCORE_LEAD',
        title: 'Lead com score muito alto encontrado',
        body: `${lead.name} atingiu ${result.value} pontos.`,
        payload: { leadId },
      },
    });
  }
}

async function currentPeriodStart(): Promise<Date> {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function settleQuota(
  prisma: PrismaClient,
  tenantId: string,
  reserved: number,
  actual: number,
): Promise<void> {
  await prisma.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: await currentPeriodStart() } },
    data: {
      leadsReserved: { decrement: reserved },
      leadsSettled: { increment: actual },
    },
  });
}

async function refundQuota(
  prisma: PrismaClient,
  tenantId: string,
  reserved: number,
): Promise<void> {
  await prisma.planUsage
    .update({
      where: {
        tenantId_periodStart: { tenantId, periodStart: await currentPeriodStart() },
      },
      data: { leadsReserved: { decrement: reserved } },
    })
    .catch(() => {
      // Sem período registrado não há o que devolver.
    });
}
