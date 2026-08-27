/**
 * Seed de demonstração do PropectAI.
 *
 * Idempotente: pode rodar quantas vezes for. Todas as escritas usam upsert
 * com chave determinística.
 *
 * Princípio: dados de demonstração vivem no PostgreSQL, marcados com
 * `isDemo: true`. Nenhum número aparece na interface sem ter saído daqui —
 * o front-end não tem mock.
 *
 * Os scores não são escritos à mão. Cada lead passa pelo motor real
 * (`computeScore`), então a demonstração acompanha qualquer mudança de peso.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { PrismaClient, type PipelineStage, type Prisma } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { PLAN_LIMITS, computeScore, type ScoreInput } from '@propectai/types';
import dotenv from 'dotenv';

import { SEED_LEADS, SEED_PREFERENCES, SEED_SEARCHES, SEED_STAGES } from './seed-data';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

const TENANT_SLUG = 'layart-demo';

/**
 * Categoria do Google Maps → nicho das preferências do tenant.
 *
 * Mapa explícito em vez de comparação por texto: "Dentista" e "Dentistas"
 * são o mesmo nicho, "Lanchonete" e "Restaurantes" não são, e adivinhar isso
 * por substring erra nos dois sentidos.
 */
const CATEGORY_TO_NICHE: Record<string, string> = {
  Dentista: 'Dentistas',
  'Clínica de estética': 'Clínicas de Estética',
  'Salão de beleza': 'Salões de Beleza',
  Academia: 'Academias',
  Restaurante: 'Restaurantes',
};

const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);
const daysAhead = (days: number): Date => new Date(Date.now() + days * 86_400_000);

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/\b(ltda|me|eireli|s\/a|sa)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `+55${digits}`;
}

/** sha256(nome normalizado + telefone E.164 + CEP) — igual ao worker. */
function fingerprint(name: string, phone: string, postalCode: string | null): string {
  return createHash('sha256')
    .update(`${normalizeName(name)}|${toE164(phone)}|${postalCode ?? ''}`)
    .digest('hex');
}

// =============================================================================

async function seedPlans(): Promise<Map<string, string>> {
  const catalog = [
    // Assinatura mensal, não vitalícia. Vitalício e cobrança recorrente são
    // modelos incompatíveis: um cobra uma vez e entrega para sempre, o outro
    // cobra todo mês. O nome do plano precisa dizer qual dos dois é, porque é
    // ele que aparece na tela onde a pessoa decide pagar.
    //
    // Os nomes mudaram em 13/08/2026 e o `code` não. O código é chave técnica
    // — está em enum do Postgres, em `PLAN_LIMITS`, nos testes e nos gates —,
    // enquanto o nome é texto de vitrine. Manter os dois separados é o que
    // permite renomear plano sem migration.
    //
    // `AGENCY` ficou factualmente errado quando o produto passou a atender
    // todos os segmentos — e a correção já foi feita onde importa: o nome de
    // vitrine é "Escala". O `code` permanece.
    //
    // O §11.1 previa renomear o code para `SCALE` junto com o passo 4, quando
    // o enum ainda existia e a varredura tocaria todos os pontos. O enum saiu
    // no passo 5, e a decisão que sobreviveu é a do próprio schema:
    // "**É chave, não rótulo.** O `code` aparece em log, auditoria e
    // integração, e mudá-lo quebra histórico. Renomear plano não toca aqui."
    //
    // Renomear o code hoje não é mais varredura de tipos: é UPDATE em dado
    // vivo, com o AuditLog guardando `AGENCY` nas trocas de plano passadas e o
    // Stripe possivelmente referenciando o código em metadata. Fica como está.
    { code: 'FREE', name: 'Explorar', priceCents: 0, sortOrder: 0 },
    { code: 'START', name: 'Base', priceCents: 2700, sortOrder: 1 },
    { code: 'PRO', name: 'Impulso', priceCents: 4700, sortOrder: 2 },
    { code: 'AGENCY', name: 'Escala', priceCents: 9700, sortOrder: 3 },
  ];

  const ids = new Map<string, string>();

  for (const plan of catalog) {
    const record = await prisma.plan.upsert({
      where: { code: plan.code },
      create: {
        code: plan.code,
        name: plan.name,
        priceCents: plan.priceCents,
        pricesByCurrency: { BRL: plan.priceCents },
        sortOrder: plan.sortOrder,
        limits: PLAN_LIMITS[plan.code] as unknown as Prisma.InputJsonValue,
      },
      update: {
        name: plan.name,
        priceCents: plan.priceCents,
        pricesByCurrency: { BRL: plan.priceCents },
        sortOrder: plan.sortOrder,
        limits: PLAN_LIMITS[plan.code] as unknown as Prisma.InputJsonValue,
        // `stripePriceId` fica de fora do update de propósito: ele é
        // configurado uma vez por ambiente e o seed roda muitas. Sobrescrever
        // com nulo aqui desligaria a cobrança a cada `pnpm db:seed`.
      },
    });
    ids.set(plan.code, record.id);
  }

  return ids;
}

async function seedTenant(planIds: Map<string, string>) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    create: {
      slug: TENANT_SLUG,
      name: process.env.SEED_TENANT_NAME ?? 'Layart Agência Digital',
      timezone: 'America/Sao_Paulo',
      isDemo: true,
    },
    update: { isDemo: true },
  });

  const freePlanId = planIds.get('FREE');
  if (freePlanId) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, planId: freePlanId, status: 'TRIALING' },
      update: { planId: freePlanId },
    });
  }

  await prisma.onboardingState.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      currentStep: 5,
      servicesSold: SEED_PREFERENCES.servicesSold,
      targetNiches: SEED_PREFERENCES.targetNiches,
      targetRegions: SEED_PREFERENCES.targetRegions,
      preferredChannel: SEED_PREFERENCES.preferredChannel,
      monthlyGoal: SEED_PREFERENCES.monthlyGoal,
      completedAt: daysAgo(20),
    },
    update: {
      servicesSold: SEED_PREFERENCES.servicesSold,
      targetNiches: SEED_PREFERENCES.targetNiches,
      targetRegions: SEED_PREFERENCES.targetRegions,
    },
  });

  // Pesos do score e lista de domínios precários ficam editáveis sem deploy.
  await prisma.appSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: 'score.weights' } },
    create: { tenantId: tenant.id, key: 'score.weights', value: {} },
    update: {},
  });

  return tenant;
}

async function seedUsers(tenantId: string) {
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Demo@123456';
  const passwordHash = await argonHash(password);

  const people = [
    {
      email: (process.env.SEED_OWNER_EMAIL ?? 'owner@demo.propectai.local').toLowerCase(),
      name: 'Uilson Távora',
      role: 'OWNER' as const,
      isDefault: true,
    },
    {
      email: (process.env.SEED_SDR_EMAIL ?? 'sdr@demo.propectai.local').toLowerCase(),
      name: 'Marina Costa',
      role: 'SDR' as const,
      isDefault: false,
    },
  ];

  const created = [];

  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: { email: person.email, name: person.name, passwordHash },
      update: { name: person.name, passwordHash },
    });

    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      create: {
        userId: user.id,
        tenantId,
        role: person.role,
        isDefault: person.isDefault,
      },
      update: { role: person.role, isDefault: person.isDefault },
    });

    created.push(user);
  }

  return created;
}

async function seedStages(tenantId: string): Promise<Map<string, PipelineStage>> {
  const stages = new Map<string, PipelineStage>();

  for (const [index, stage] of SEED_STAGES.entries()) {
    const record = await prisma.pipelineStage.upsert({
      where: { tenantId_slug: { tenantId, slug: stage.slug } },
      create: {
        tenantId,
        slug: stage.slug,
        name: stage.name,
        color: stage.color,
        order: index,
        isTerminal: stage.isTerminal ?? false,
        isWon: stage.isWon ?? false,
      },
      update: { name: stage.name, color: stage.color, order: index },
    });
    stages.set(stage.slug, record);
  }

  return stages;
}

async function seedSearches(tenantId: string) {
  const searches = new Map<string, string>();

  for (const search of SEED_SEARCHES) {
    const existing = await prisma.prospectingSearch.findFirst({
      where: { tenantId, niche: search.niche, city: search.city, isDemo: true },
    });

    const record =
      existing ??
      (await prisma.prospectingSearch.create({
        data: {
          tenantId,
          niche: search.niche,
          stateUf: search.stateUf,
          city: search.city,
          neighborhood: search.neighborhood,
          radiusKm: search.radiusKm,
          requestedCount: search.requestedCount,
          duplicatesFound: search.duplicates,
          isDemo: true,
          createdAt: daysAgo(search.daysAgo),
        },
      }));

    const jobExists = await prisma.scrapeJob.findFirst({
      where: { tenantId, searchId: record.id },
    });

    if (!jobExists) {
      await prisma.scrapeJob.create({
        data: {
          tenantId,
          searchId: record.id,
          status: search.status,
          source: 'MOCK',
          idempotencyKey: `demo:${search.key}`,
          keyword: `${search.niche} em ${search.city}, ${search.stateUf}`,
          resultCount: search.status === 'FAILED' ? 0 : search.requestedCount,
          duplicateCount: search.duplicates,
          durationMs: search.durationMs,
          errorCode: search.status === 'FAILED' ? 'SOURCE_TIMEOUT' : null,
          errorMessage:
            search.status === 'FAILED'
              ? 'A fonte não respondeu dentro do limite de 300 segundos'
              : null,
          startedAt: daysAgo(search.daysAgo),
          finishedAt: daysAgo(search.daysAgo),
          createdAt: daysAgo(search.daysAgo),
        },
      });
    }

    searches.set(search.key, record.id);
  }

  return searches;
}

async function seedLeads(
  tenantId: string,
  stages: Map<string, PipelineStage>,
  searches: Map<string, string>,
  ownerId: string,
) {
  const searchByNiche: Record<string, string | undefined> = {
    Dentista: searches.get('dentistas-sp'),
    'Clínica de estética': searches.get('estetica-sp'),
    Academia: searches.get('academias-guarulhos'),
  };

  const distribution: Record<string, number> = {};
  let created = 0;

  for (const [index, seed] of SEED_LEADS.entries()) {
    const fp = fingerprint(seed.name, seed.phone, seed.postalCode);

    const scoreInput: ScoreInput = {
      websiteStatus: seed.websiteStatus,
      websiteHasHttps: seed.websiteHasHttps,
      hasPhone: true,
      whatsappStatus: seed.isMobile ? 'LIKELY' : 'UNKNOWN',
      email: seed.email,
      reviewCount: seed.reviewCount,
      reviewRating: seed.reviewRating,
      hasOpenHours: seed.hasOpenHours,
      hasCompleteAddress: Boolean(seed.postalCode),
      isPriorityNiche: SEED_PREFERENCES.targetNiches.includes(
        CATEGORY_TO_NICHE[seed.category] ?? '',
      ),
      isServedRegion: SEED_PREFERENCES.targetRegions.some((region) =>
        region.toLowerCase().startsWith(seed.city.toLowerCase()),
      ),
      lastContactedAt: null,
      lastEnrichedAt: daysAgo(index % 10),
      isSuppressed: false,
      isPermanentlyClosed: false,
    };

    const score = computeScore(scoreInput);
    distribution[score.level] = (distribution[score.level] ?? 0) + 1;

    const lead = await prisma.lead.upsert({
      where: { tenantId_fingerprint: { tenantId, fingerprint: fp } },
      create: {
        tenantId,
        searchId: searchByNiche[seed.category] ?? null,
        name: seed.name,
        category: seed.category,
        phoneE164: toE164(seed.phone),
        phoneRaw: seed.phone,
        email: seed.email,
        website: seed.website,
        websiteStatus: seed.websiteStatus,
        addressNeighborhood: seed.neighborhood,
        addressCity: seed.city,
        addressStateUf: seed.stateUf,
        addressPostalCode: seed.postalCode,
        addressFull: `${seed.neighborhood}, ${seed.city} - ${seed.stateUf}`,
        reviewCount: seed.reviewCount,
        reviewRating: seed.reviewRating,
        openHours: seed.hasOpenHours
          ? { 'segunda-feira': ['09:00–18:00'], sábado: ['09:00–13:00'] }
          : undefined,
        timezone: 'America/Sao_Paulo',
        source: 'MOCK',
        placeId: `demo-place-${String(index + 1).padStart(3, '0')}`,
        fingerprint: fp,
        isFavorite: index % 7 === 0,
        isDemo: true,
        lastEnrichedAt: scoreInput.lastEnrichedAt,
        createdAt: daysAgo(14 - (index % 14)),
      },
      update: { isDemo: true },
    });

    created += 1;

    // ---- Presença digital --------------------------------------------------
    // Instagram e Facebook ficam DESCONHECIDO: o scraper não entrega esses
    // sinais e não houve enriquecimento. Marcá-los como AUSENTE seria falso
    // negativo — a regra que este produto existe para não repetir.
    await prisma.leadDigitalPresence.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId,
        leadId: lead.id,
        hasWebsite: seed.websiteStatus === 'SEM_SITE' ? 'AUSENTE' : 'PRESENTE',
        hasEmail: seed.email ? 'PRESENTE' : 'DESCONHECIDO',
        hasPhone: 'PRESENTE',
        hasInstagram: 'DESCONHECIDO',
        hasFacebook: 'DESCONHECIDO',
        hasReviews: seed.reviewCount > 0 ? 'PRESENTE' : 'AUSENTE',
        whatsappStatus: seed.isMobile ? 'LIKELY' : 'UNKNOWN',
        websiteHasHttps: seed.websiteHasHttps,
        lastCheckedAt: scoreInput.lastEnrichedAt,
      },
      update: {},
    });

    // ---- Score e motivos ---------------------------------------------------
    const leadScore = await prisma.leadScore.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId,
        leadId: lead.id,
        value: score.value,
        level: score.level,
        algorithmVersion: score.algorithmVersion,
      },
      update: { value: score.value, level: score.level },
    });

    await prisma.leadScoreReason.deleteMany({ where: { scoreId: leadScore.id } });
    await prisma.leadScoreReason.createMany({
      data: score.reasons.map((reason) => ({
        tenantId,
        scoreId: leadScore.id,
        code: reason.code,
        label: reason.label,
        weight: reason.weight,
        polarity: reason.polarity,
        evidence: reason.evidence,
      })),
    });

    // ---- Card no pipeline --------------------------------------------------
    const stage = stages.get(seed.stage);
    if (stage) {
      await prisma.pipelineCard.upsert({
        where: { leadId: lead.id },
        create: {
          tenantId,
          leadId: lead.id,
          stageId: stage.id,
          ownerId,
          position: index,
          enteredStageAt: daysAgo(index % 10),
        },
        update: { stageId: stage.id },
      });
    }
  }

  return { created, distribution };
}

async function seedActivity(tenantId: string, ownerId: string) {
  const advanced = await prisma.lead.findMany({
    where: {
      tenantId,
      pipelineCard: { stage: { slug: { notIn: ['novo'] } } },
    },
    take: 12,
    orderBy: { createdAt: 'asc' },
  });

  for (const [index, lead] of advanced.entries()) {
    const existing = await prisma.leadContactRecord.findFirst({
      where: { leadId: lead.id },
    });
    if (existing) continue;

    await prisma.leadContactRecord.create({
      data: {
        tenantId,
        leadId: lead.id,
        authorId: ownerId,
        channel: index % 3 === 0 ? 'EMAIL' : 'WHATSAPP',
        direction: index % 4 === 0 ? 'RECEIVED' : 'SENT',
        outcome: index % 4 === 0 ? 'Respondeu pedindo proposta' : 'Mensagem entregue',
        notes: 'Registro de demonstração.',
        occurredAt: daysAgo(index + 1),
      },
    });

    await prisma.leadActivity.create({
      data: {
        tenantId,
        leadId: lead.id,
        actorId: ownerId,
        type: 'CONTACT_REGISTERED',
        metadata: { demo: true },
        createdAt: daysAgo(index + 1),
      },
    });
  }

  // ---- Follow-ups: 2 vencidos, 3 pendentes, 1 concluído --------------------
  const followUpTargets = await prisma.lead.findMany({
    where: { tenantId, isDemo: true },
    take: 6,
    orderBy: { name: 'asc' },
  });

  const plan = [
    { status: 'OVERDUE' as const, dueAt: daysAgo(4), priority: 'HIGH' as const },
    { status: 'OVERDUE' as const, dueAt: daysAgo(1), priority: 'MEDIUM' as const },
    { status: 'PENDING' as const, dueAt: daysAhead(1), priority: 'HIGH' as const },
    { status: 'PENDING' as const, dueAt: daysAhead(3), priority: 'MEDIUM' as const },
    { status: 'PENDING' as const, dueAt: daysAhead(6), priority: 'LOW' as const },
    { status: 'COMPLETED' as const, dueAt: daysAgo(7), priority: 'MEDIUM' as const },
  ];

  for (const [index, lead] of followUpTargets.entries()) {
    const item = plan[index];
    if (!item) continue;

    const existing = await prisma.leadFollowUp.findFirst({ where: { leadId: lead.id } });
    if (existing) continue;

    await prisma.leadFollowUp.create({
      data: {
        tenantId,
        leadId: lead.id,
        ownerId,
        channel: 'WHATSAPP',
        priority: item.priority,
        status: item.status,
        dueAt: item.dueAt,
        notes: 'Follow-up de demonstração.',
        completedAt: item.status === 'COMPLETED' ? daysAgo(7) : null,
      },
    });
  }
}

async function seedNotifications(tenantId: string) {
  const existing = await prisma.notification.count({ where: { tenantId } });
  if (existing > 0) return;

  await prisma.notification.createMany({
    data: [
      {
        tenantId,
        type: 'HIGH_SCORE_LEAD',
        title: 'Lead com score muito alto encontrado',
        body: 'Sorriso Vivo Odontologia atingiu 91 pontos.',
        createdAt: daysAgo(1),
      },
      {
        tenantId,
        type: 'SEARCH_COMPLETED',
        title: 'Busca concluída',
        body: 'Clínicas de Estética em São Paulo: 10 leads, 3 duplicados.',
        createdAt: daysAgo(6),
      },
      {
        tenantId,
        type: 'SEARCH_FAILED',
        title: 'Busca não concluída',
        body: 'Academias em Guarulhos: a fonte não respondeu no tempo limite. Créditos devolvidos.',
        createdAt: daysAgo(2),
      },
      {
        tenantId,
        type: 'FOLLOWUP_OVERDUE',
        title: '2 follow-ups vencidos',
        body: 'Há contatos aguardando retorno há mais de um dia.',
        createdAt: daysAgo(1),
      },
      {
        tenantId,
        type: 'LIMIT_NEAR',
        title: 'Limite de leads próximo',
        body: 'Você usou 5 dos 5 leads do plano FREE.',
        readAt: daysAgo(3),
        createdAt: daysAgo(3),
      },
    ],
  });
}

// =============================================================================

async function main(): Promise<void> {
  console.log('\n  Seed do PropectAI\n  ─────────────────');

  const planIds = await seedPlans();
  console.log(`  Planos              ${planIds.size}`);

  const tenant = await seedTenant(planIds);
  console.log(`  Tenant              ${tenant.name} (${tenant.slug})`);

  const users = await seedUsers(tenant.id);
  const owner = users[0];
  if (!owner) throw new Error('Usuário owner não foi criado');
  console.log(`  Usuários            ${users.length}`);

  const stages = await seedStages(tenant.id);
  console.log(`  Etapas do pipeline  ${stages.size}`);

  const searches = await seedSearches(tenant.id);
  console.log(`  Buscas              ${searches.size}`);

  const { created, distribution } = await seedLeads(tenant.id, stages, searches, owner.id);
  console.log(`  Leads               ${created}`);
  console.log(
    `    muito alta ${distribution.MUITO_ALTA ?? 0} · alta ${distribution.ALTA ?? 0} · ` +
      `média ${distribution.MEDIA ?? 0} · baixa ${distribution.BAIXA ?? 0}`,
  );

  await seedActivity(tenant.id, owner.id);
  await seedNotifications(tenant.id);
  console.log('  Contatos, follow-ups e notificações  ok');

  // Consumo do plano FREE: 5 leads incluídos, todos usados.
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  await prisma.planUsage.upsert({
    where: { tenantId_periodStart: { tenantId: tenant.id, periodStart } },
    create: {
      tenantId: tenant.id,
      periodStart,
      periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      leadsSettled: 5,
      searchesCount: 3,
    },
    update: {},
  });

  const withoutScore = await prisma.lead.count({
    where: { tenantId: tenant.id, score: null },
  });

  if (withoutScore > 0) {
    throw new Error(
      `${withoutScore} lead(s) ficaram sem score. Isso é bug, não resultado.`,
    );
  }

  console.log('\n  Credenciais de demonstração');
  console.log(`    ${users[0]?.email}  ·  ${process.env.SEED_OWNER_PASSWORD ?? 'Demo@123456'}`);
  console.log(`    ${users[1]?.email}  ·  ${process.env.SEED_SDR_PASSWORD ?? 'Demo@123456'}`);
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('\n  Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
