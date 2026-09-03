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

import { comTenant } from '../db/com-tenant';
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
 *
 * ---
 *
 * ## Por que aqui não existe "um bloco só"
 *
 * Este é o arquivo mais longo do worker em tempo de parede: entre pedir a busca
 * à fonte e receber os resultados há um laço de sondagem que pode durar **seis
 * minutos**. Não existe transação que cubra o ciclo — o `timeout` de 10 s do
 * `comTenant` existe justamente para que uma tentativa dessas apareça como erro
 * em vez de conexão presa.
 *
 * A forma que sobra, e que é a mesma do `process-audit-job.ts`:
 *
 *   bloco: marcar RUNNING, ler a busca
 *   ---- fora: provider.createSearch() ----
 *   bloco: gravar o id externo
 *   ---- fora: o laço de sondagem, até 6 minutos ----
 *   bloco: marcar NORMALIZING
 *   ---- fora: provider.getResults() ----
 *   bloco: ler o onboarding
 *   um bloco POR LEAD: gravar o lead e a presença digital
 *   um bloco POR LEAD: calcular e gravar o score
 *   bloco: liquidar a cota e fechar a busca
 *   bloco: concluir, notificar e auditar
 *
 * ### Um bloco por lead, e não um para o laço inteiro
 *
 * A escolha é do domínio, não de desempenho. Cada lead vale por si: um lote que
 * perde 49 leads bons porque o 50º violou uma restrição é pior do que 49
 * gravados e um perdido — a coleta já custou os minutos de sondagem e já
 * consumiu a chamada à fonte, e nada disso se refaz de graça.
 *
 * **É o oposto da escolha em `account.recalculateAllScores`**, que processa em
 * lotes de 100. Lá o trabalho é recálculo puro, idempotente e refazível a
 * qualquer momento; perder um lote não perde nada. Aqui perder um lead perde
 * trabalho pago que não volta. Mesma pergunta, respostas diferentes, porque o
 * que está em jogo é diferente.
 *
 * O custo são N transações a ~5 ms cada. Num job que passou minutos sondando a
 * fonte, meio segundo não é grandeza que se discuta.
 */
export async function processScrapeJob(
  prisma: PrismaClient,
  provider: LeadSourceProvider,
  payload: ScrapeJobPayload,
): Promise<{ newLeads: number; duplicates: number }> {
  const startedAt = Date.now();
  const { tenantId, searchId, scrapeJobId, keyword, requestedCount } = payload;

  /**
   * A escrita do estado, sem transação própria.
   *
   * Existe separada porque o estado é gravado em dois regimes: sozinho, entre
   * duas esperas pela fonte, e junto com o fechamento do job. Quem chama decide
   * qual — e é por isso que ela recebe o `tx` em vez de abrir o dela.
   */
  const atualizarJob = async (
    tx: Prisma.TransactionClient,
    status: string,
    data: Prisma.ScrapeJobUpdateInput = {},
  ): Promise<void> => {
    await tx.scrapeJob.update({
      where: { id: scrapeJobId },
      data: { status: status as never, ...data },
    });
  };

  /** O regime "sozinho": um bloco só para esta marcação. */
  const setStatus = async (
    status: string,
    data: Prisma.ScrapeJobUpdateInput = {},
  ): Promise<void> => {
    await comTenant(prisma, tenantId, (tx) => atualizarJob(tx, status, data));
  };

  try {
    // ---- 1. Consulta à fonte ------------------------------------------------
    const search = await comTenant(prisma, tenantId, async (tx) => {
      await atualizarJob(tx, 'RUNNING', {
        startedAt: new Date(),
        attempts: { increment: 1 },
      });

      return tx.prospectingSearch.findUniqueOrThrow({ where: { id: searchId } });
    });

    // I/O externo — fora de transação, de propósito.
    const sourceJob = await provider.createSearch({
      keyword,
      lang: 'pt',
      radiusKm: search.radiusKm,
      maxDepth: Math.max(1, Math.ceil(requestedCount / 20)),
      extractEmail: true,
    });

    await comTenant(prisma, tenantId, (tx) =>
      tx.scrapeJob.update({
        where: { id: scrapeJobId },
        data: { externalJobId: sourceJob.externalJobId },
      }),
    );

    // ---- 2. Acompanhamento --------------------------------------------------
    // Até seis minutos aqui. Nenhuma transação aberta.
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

    const onboarding = await comTenant(prisma, tenantId, (tx) =>
      tx.onboardingState.findUnique({ where: { tenantId } }),
    );

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
    //
    // A liquidação e o fechamento da busca num bloco só: são o mesmo fato
    // contábil visto de dois lados, e separá-los permitia cobrar sem registrar
    // o que foi entregue.
    await comTenant(prisma, tenantId, async (tx) => {
      await settleQuota(tx, tenantId, requestedCount, createdLeadIds.length);

      await tx.prospectingSearch.update({
        where: { id: searchId },
        data: { leadsFound: createdLeadIds.length, duplicatesFound: duplicates },
      });
    });

    const durationMs = Date.now() - startedAt;

    // Veredito sobre o termo sugerido, se a busca usou um.
    //
    // `rawLeads.length` e o numero que importa, nao `createdLeadIds.length`:
    // duplicado prova que o termo encontra empresas tanto quanto lead novo. Um
    // termo bom numa base ja coletada devolveria zero novos e seria reprovado
    // injustamente.
    await registrarVeredito(prisma, tenantId, searchId, rawLeads.length);

    /**
     * Concluir, notificar e auditar — num bloco só.
     *
     * **Conserta um defeito que já estava aqui.** Eram três escritas soltas: se
     * a notificação falhasse, o job ficava `COMPLETED` e o cliente nunca ficava
     * sabendo que a busca dele terminou. A tela mostraria uma busca concluída
     * sem aviso nenhum, e não haveria registro de que o aviso se perdeu.
     */
    await comTenant(prisma, tenantId, async (tx) => {
      await atualizarJob(tx, 'COMPLETED', {
        finishedAt: new Date(),
        durationMs,
        resultCount: rawLeads.length,
        newLeadCount: createdLeadIds.length,
        duplicateCount: duplicates,
      });

      await tx.notification.create({
        data: {
          tenantId,
          type: 'SEARCH_COMPLETED',
          title: 'Busca concluída',
          body: `${keyword}: ${createdLeadIds.length} leads novos, ${duplicates} duplicados.`,
          payload: { searchId },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'prospecting.job.completed',
          entityType: 'ScrapeJob',
          entityId: scrapeJobId,
          after: { newLeads: createdLeadIds.length, duplicates, durationMs },
        },
      });
    });

    return { newLeads: createdLeadIds.length, duplicates };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ scrapeJobId, error: message }, 'Job de coleta falhou');

    // Devolve toda a reserva: o cliente não paga por busca que não entregou.
    await refundQuota(prisma, tenantId, requestedCount);

    /**
     * O resgate fica **fora** do bloco da devolução, de propósito.
     *
     * Marcar FAILED e avisar são o que o cliente vê; a devolução é o que ele
     * recebe. Se as três estivessem juntas, uma falha na devolução deixaria o
     * job preso no estado anterior e sem aviso — o pior dos três resultados.
     * Separadas, cada uma acontece pelo que puder acontecer.
     */
    await comTenant(prisma, tenantId, async (tx) => {
      await atualizarJob(tx, 'FAILED', {
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorCode: 'SOURCE_ERROR',
        errorMessage: message,
      });

      await tx.notification.create({
        data: {
          tenantId,
          type: 'SEARCH_FAILED',
          title: 'Busca não concluída',
          body: `${keyword}: ${message}. Os créditos foram devolvidos.`,
          payload: { searchId },
        },
      });
    });

    throw error;
  }
}

// =============================================================================

/**
 * Grava um lead e o que vem com ele.
 *
 * Um bloco por lead: o `lead`, o `leadSourceRecord` e o `leadDigitalPresence`
 * **precisam** nascer juntos. Um lead sem a linha de presença digital passa
 * pelo `scoreLead` com `digitalPresence` nulo e recebe um score calculado sobre
 * dados que existem mas não foram lidos — um número errado, sem erro nenhum
 * para indicá-lo.
 */
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

  return comTenant(prisma, tenantId, async (tx) => {
    // Deduplicação: placeId primeiro, fingerprint depois.
    const existing = await tx.lead.findFirst({
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
      await tx.lead.update({
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

    const lead = await tx.lead.create({
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
    await tx.leadSourceRecord.create({
      data: {
        tenantId,
        leadId: lead.id,
        scrapeJobId,
        source: 'GOOGLE_MAPS',
        sourceId: raw.placeId,
        payload: raw as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.leadDigitalPresence.create({
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
  });
}

/**
 * Calcula e grava o score de um lead.
 *
 * Um bloco por lead, pela mesma razão do `upsertLead`, mais uma: o
 * `deleteMany` seguido de `createMany` nas razões. Soltos, uma falha entre os
 * dois deixava o lead com score e **nenhuma razão** — número sem explicação, e
 * nada indicando que faltava algo. É o mesmo defeito que estava em
 * `LeadsService.recalculateScore`, aqui pela segunda vez.
 *
 * O `computeScore` fica dentro do bloco. Ele custa microssegundos e uma
 * transação a mais custa ~5 ms medidos: tirá-lo pagaria mil vezes o que
 * economiza.
 */
async function scoreLead(
  prisma: PrismaClient,
  tenantId: string,
  leadId: string,
  niches: string[],
  regions: string[],
): Promise<void> {
  await comTenant(prisma, tenantId, async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({
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

    if (result.value >= 85) {
      await tx.notification.create({
        data: {
          tenantId,
          type: 'HIGH_SCORE_LEAD',
          title: 'Lead com score muito alto encontrado',
          body: `${lead.name} atingiu ${result.value} pontos.`,
          payload: { leadId },
        },
      });
    }
  });
}

/** Mínimo de resultados para um termo sugerido deixar de ser suspeito. */
const MIN_RESULTADOS_PARA_VALIDAR = 3;

/**
 * Registra o veredito sobre um termo sugerido pela taxonomia.
 *
 * A busca já rodou e já custou o que ia custar. O número de resultados
 * responde de graça a pergunta que a geração por modelo não consegue: **esse
 * termo existe de verdade naquele país?**
 *
 * Validar com scraper dedicado exigiria um job por termo — minutos por
 * segmento, consumindo capacidade que o cliente paga.
 *
 * Termo `CURADO` não é rebaixado: veio de pessoa, e um resultado ruim numa
 * cidade pequena não invalida o termo. Só o `GERADO` está em julgamento.
 *
 * ---
 *
 * **Duas tabelas de naturezas opostas, e é por isso que o `tenantId` passou a
 * ser parâmetro.** `prospecting_searches` tem `tenantId` e a leitura dela
 * precisa de contexto declarado. `segment_locales` **não tem**: a taxonomia é
 * global, compartilhada por todos os clientes, e é justamente o que dá valor ao
 * veredito — o termo que um tenant provou serve para o próximo.
 *
 * Envolver a escrita do locale num bloco de tenant não quebraria nada hoje
 * (não há política sobre ela), mas sugeriria um escopo que não existe. Fica de
 * fora, e a diferença fica escrita.
 */
async function registrarVeredito(
  prisma: PrismaClient,
  tenantId: string,
  searchId: string,
  resultados: number,
): Promise<void> {
  const search = await comTenant(prisma, tenantId, (tx) =>
    tx.prospectingSearch.findUnique({
      where: { id: searchId },
      select: { segmentLocaleId: true },
    }),
  );

  if (!search?.segmentLocaleId) return;

  // Daqui para baixo, taxonomia global. Sem tenant, de propósito.
  const locale = await prisma.segmentLocale.findUnique({
    where: { id: search.segmentLocaleId },
  });

  if (!locale || locale.status !== 'GERADO') return;

  if (resultados >= MIN_RESULTADOS_PARA_VALIDAR) {
    await prisma.segmentLocale.update({
      where: { id: locale.id },
      data: { status: 'VALIDADO', validatedAt: new Date(), resultCount: resultados },
    });

    logger.info(
      { locale: locale.locale, termos: locale.searchTerms, resultados },
      'Termo sugerido validado por busca real',
    );
    return;
  }

  // Zero resultado não apaga o termo: pode ser cidade sem esse tipo de
  // negócio, não termo errado. Registrar a contagem deixa o padrão visível —
  // termo que falha em várias cidades é termo inventado, e aí a evidência
  // está no banco em vez de na intuição de alguém.
  await prisma.segmentLocale.update({
    where: { id: locale.id },
    data: { resultCount: resultados },
  });

  logger.warn(
    { locale: locale.locale, termos: locale.searchTerms, resultados },
    'Termo sugerido devolveu poucos resultados',
  );
}

function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Recebe o `tx`: é chamada de dentro do bloco que fecha a busca. */
async function settleQuota(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reserved: number,
  actual: number,
): Promise<void> {
  await tx.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: currentPeriodStart() } },
    data: {
      leadsReserved: { decrement: reserved },
      leadsSettled: { increment: actual },
    },
  });
}

/**
 * Devolve a reserva de uma busca que não entregou.
 *
 * **Duas mudanças aqui, e as duas são a mesma armadilha vista de ângulos
 * diferentes.**
 *
 * 1. `updateMany` no lugar de `update`. O caso comum — tenant sem período
 *    registrado — deixa de ser exceção e passa a ser zero linhas. Não havia
 *    nada de errado nele; só não era erro.
 *
 * 2. **O `.catch` está do lado de fora do bloco.** Dentro, ele seria veneno:
 *    depois de um erro o Postgres põe a transação em estado abortado, todo
 *    comando seguinte responde `25P02`, e o `COMMIT` vira `ROLLBACK` **sem
 *    lançar** — um `catch` ali engoliria a perda inteira em silêncio. Fora, a
 *    transação já foi desfeita e a conexão devolvida antes de a promessa
 *    rejeitar, e o `catch` faz o que sempre quis fazer: não derrubar o resgate
 *    por causa de uma devolução que não tinha o que devolver.
 *
 * **É a segunda vez que este mesmo defeito aparece.** O primeiro foi o
 * `devolverCota` do `AuditsService`, consertado em 27/08. Este sobreviveu
 * porque eu consertei a ocorrência que estava olhando em vez de procurar as
 * outras — o mesmo padrão do "4 PipelineStage" e do teste de billing.
 */
async function refundQuota(
  prisma: PrismaClient,
  tenantId: string,
  reserved: number,
): Promise<void> {
  await comTenant(prisma, tenantId, (tx) =>
    tx.planUsage.updateMany({
      where: { tenantId, periodStart: currentPeriodStart() },
      data: { leadsReserved: { decrement: reserved } },
    }),
  ).catch((erro: unknown) => {
    logger.warn(
      { tenantId, erro: erro instanceof Error ? erro.message : String(erro) },
      'Não foi possível devolver a reserva de cota',
    );
  });
}
