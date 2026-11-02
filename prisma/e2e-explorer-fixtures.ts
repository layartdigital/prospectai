/**
 * Fixtures sinteticas do E2E do Intelligence Explorer (P04-QA-04).
 *
 * **So para banco efemero de CI ou desenvolvimento local.** Nao e seed de
 * producao e nao deve ser executado no servidor. O script recusa rodar se o
 * host do banco nao for local (localhost / 127.0.0.1 / ::1 / "postgres").
 *
 * Roda DEPOIS de `pnpm db:seed`: o workspace Alfa e o tenant de demonstracao
 * (`layart-demo`) com o OWNER do seed; o Beta e um tenant novo, com usuario
 * proprio, criado aqui. Ambos entram no banco **pela mesma via do seed** (Prisma
 * real, papel `propectai_migrator`) — nao ha SQL escrito a mao nem mock.
 *
 * Todos os dados sao ficticios e o nome de cada registro carrega "E2E", para
 * que nenhuma consulta confunda fixture com dado de demonstracao.
 *
 * Idempotente: pode rodar mais de uma vez; registros sao localizados por chave
 * deterministica (fingerprint / slug / e-mail) e os filhos do lead-hub sao
 * recriados do zero.
 *
 * Saida: um manifesto JSON (ids e nomes, **nenhuma senha**) em
 * `apps/web/e2e/.generated/e2e-manifest.json`, lido pelas specs.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { hash as argonHash } from '@node-rs/argon2';
import type { PipelineStage, Prisma } from '@prisma/client';
import { computeScore, pessoasDoSeed, type ScoreInput } from '@propectai/types';

import { criarPrismaScript } from './cliente';
import { SEED_STAGES } from './seed-data';

const prisma = criarPrismaScript();

const ALFA_SLUG = 'layart-demo';
const BETA_SLUG = 'e2e-beta';
const BETA_EMAIL = 'beta@e2e.propectai.local';
const SENHA_MINIMA = 12;

const MANIFESTO = path.resolve(process.cwd(), 'apps/web/e2e/.generated/e2e-manifest.json');

/** Quantas notas/atividades o hub recebe. 11 notas = 2 paginas de 8 (8 + 3). */
const NOTAS_DO_HUB = 11;
const ATIVIDADES_DO_HUB = 4;
const SATELITES = 11;

const daysAgo = (d: number): Date => new Date(Date.now() - d * 86_400_000);

function exigirBancoLocal(): void {
  const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error('DATABASE_URL_MIGRATOR/DATABASE_URL ausente ou invalida.');
  }
  const locais = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  if (!locais.has(host)) {
    throw new Error(
      `Recusado: o host do banco ("${host}") nao e local. Estas fixtures sao so para banco efemero.`,
    );
  }
}

function fp(chave: string): string {
  return createHash('sha256').update(`e2e-explorer|${chave}`).digest('hex');
}

interface LeadSpec {
  chave: string;
  tenantId: string;
  name: string;
  category: string;
  city: string;
  stateUf: string;
  searchId: string | null;
  deletedAt?: Date | null;
  /** Nome do estagio (slug) onde entra no pipeline; omitido = sem cartao. */
  stageSlug?: string;
  ownerId?: string;
  withScoreAndPresence: boolean;
}

async function criarLead(spec: LeadSpec, stages: Map<string, PipelineStage>): Promise<string> {
  const lead = await prisma.lead.upsert({
    where: { tenantId_fingerprint: { tenantId: spec.tenantId, fingerprint: fp(spec.chave) } },
    create: {
      tenantId: spec.tenantId,
      searchId: spec.searchId,
      name: spec.name,
      category: spec.category,
      phoneE164: `+5511900${String(parseInt(fp(spec.chave).slice(0, 5), 16) % 100_000).padStart(5, '0')}`,
      email: null,
      websiteStatus: 'SITE_PRECARIO',
      website: null,
      addressCity: spec.city,
      addressStateUf: spec.stateUf,
      addressFull: `${spec.city} - ${spec.stateUf}`,
      reviewCount: 12,
      reviewRating: 4.2,
      timezone: 'America/Sao_Paulo',
      source: 'MOCK',
      placeId: `e2e-${spec.chave}`,
      fingerprint: fp(spec.chave),
      isDemo: true,
      lastEnrichedAt: daysAgo(1),
      deletedAt: spec.deletedAt ?? null,
    },
    update: {
      name: spec.name,
      searchId: spec.searchId,
      deletedAt: spec.deletedAt ?? null,
    },
  });

  if (spec.withScoreAndPresence) {
    const input: ScoreInput = {
      websiteStatus: 'SITE_PRECARIO',
      websiteHasHttps: 'DESCONHECIDO',
      hasPhone: true,
      whatsappStatus: 'LIKELY',
      email: null,
      reviewCount: 12,
      reviewRating: 4.2,
      hasOpenHours: true,
      hasCompleteAddress: false,
      isPriorityNiche: true,
      isServedRegion: true,
      lastContactedAt: null,
      lastEnrichedAt: daysAgo(1),
      isSuppressed: false,
      isPermanentlyClosed: false,
    };
    const score = computeScore(input);

    await prisma.leadDigitalPresence.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId: spec.tenantId,
        leadId: lead.id,
        hasWebsite: 'PRESENTE',
        hasEmail: 'AUSENTE',
        hasPhone: 'PRESENTE',
        // Ausencia de sinal e DESCONHECIDO, nunca AUSENTE (regra 4 do projeto).
        hasInstagram: 'DESCONHECIDO',
        hasFacebook: 'DESCONHECIDO',
        hasReviews: 'PRESENTE',
        whatsappStatus: 'LIKELY',
        websiteHasHttps: 'DESCONHECIDO',
        lastCheckedAt: daysAgo(1),
      },
      update: {},
    });

    const leadScore = await prisma.leadScore.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId: spec.tenantId,
        leadId: lead.id,
        value: score.value,
        level: score.level,
        algorithmVersion: score.algorithmVersion,
      },
      update: { value: score.value, level: score.level },
    });
    await prisma.leadScoreReason.deleteMany({ where: { scoreId: leadScore.id } });
    await prisma.leadScoreReason.createMany({
      data: score.reasons.map((r) => ({
        tenantId: spec.tenantId,
        scoreId: leadScore.id,
        code: r.code,
        label: r.label,
        weight: r.weight,
        polarity: r.polarity,
        evidence: r.evidence,
      })),
    });
  }

  if (spec.stageSlug) {
    const stage = stages.get(spec.stageSlug);
    if (!stage) throw new Error(`Etapa ${spec.stageSlug} inexistente no tenant ${spec.tenantId}`);
    await prisma.pipelineCard.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId: spec.tenantId,
        leadId: lead.id,
        stageId: stage.id,
        ownerId: spec.ownerId ?? null,
        position: 900 + (parseInt(fp(spec.chave).slice(0, 4), 16) % 90),
        enteredStageAt: daysAgo(2),
      },
      update: { stageId: stage.id },
    });
  }

  return lead.id;
}

async function etapas(tenantId: string): Promise<Map<string, PipelineStage>> {
  const mapa = new Map<string, PipelineStage>();
  for (const [i, s] of SEED_STAGES.entries()) {
    const r = await prisma.pipelineStage.upsert({
      where: { tenantId_slug: { tenantId, slug: s.slug } },
      create: {
        tenantId,
        slug: s.slug,
        name: s.name,
        color: s.color,
        order: i,
        isTerminal: s.isTerminal ?? false,
        isWon: s.isWon ?? false,
      },
      update: { name: s.name, color: s.color, order: i },
    });
    mapa.set(s.slug, r);
  }
  return mapa;
}

async function pesquisa(tenantId: string, niche: string, city: string): Promise<string> {
  const existente = await prisma.prospectingSearch.findFirst({
    where: { tenantId, niche, city, isDemo: true },
  });
  if (existente) {
    await prisma.prospectingSearch.update({ where: { id: existente.id }, data: { deletedAt: null } });
    return existente.id;
  }
  const nova = await prisma.prospectingSearch.create({
    data: {
      tenantId,
      niche,
      stateUf: 'SP',
      city,
      radiusKm: 10,
      requestedCount: 20,
      leadsFound: SATELITES + 1,
      isDemo: true,
      createdAt: daysAgo(3),
    },
  });
  return nova.id;
}

async function main(): Promise<void> {
  exigirBancoLocal();

  const senhaBeta = (process.env.E2E_BETA_PASSWORD ?? '').trim();
  if (senhaBeta.length < SENHA_MINIMA) {
    throw new Error(`E2E_BETA_PASSWORD ausente ou com menos de ${SENHA_MINIMA} caracteres.`);
  }
  const pessoas = pessoasDoSeed(process.env);
  const owner = pessoas.find((p) => p.papel === 'OWNER');
  if (!owner) throw new Error('OWNER do seed nao encontrado.');
  if (owner.senha === senhaBeta) {
    throw new Error('E2E_BETA_PASSWORD nao pode ser igual a SEED_OWNER_PASSWORD.');
  }

  // ------------------------------ Alfa (tenant de demonstracao) -------------
  const alfa = await prisma.tenant.findUnique({ where: { slug: ALFA_SLUG } });
  if (!alfa) throw new Error(`Tenant ${ALFA_SLUG} nao existe: rode "pnpm db:seed" antes.`);
  const alfaOwner = await prisma.user.findUnique({ where: { email: owner.email } });
  if (!alfaOwner) throw new Error('Usuario OWNER do seed nao existe: rode "pnpm db:seed" antes.');
  const etapasAlfa = await etapas(alfa.id);

  const buscaAlfa = await pesquisa(alfa.id, 'Pesquisa E2E Alfa', 'Sao Paulo');

  const hubId = await criarLead(
    {
      chave: 'alfa-hub',
      tenantId: alfa.id,
      name: 'Alfa Hub Relacional E2E',
      category: 'Dentista',
      city: 'Sao Paulo',
      stateUf: 'SP',
      searchId: buscaAlfa,
      stageSlug: 'respondeu',
      ownerId: alfaOwner.id,
      withScoreAndPresence: true,
    },
    etapasAlfa,
  );

  const satelites: string[] = [];
  for (let i = 1; i <= SATELITES; i += 1) {
    const n = String(i).padStart(2, '0');
    satelites.push(
      await criarLead(
        {
          chave: `alfa-sat-${n}`,
          tenantId: alfa.id,
          name: `Alfa Satelite E2E ${n}`,
          category: 'Dentista',
          city: 'Sao Paulo',
          stateUf: 'SP',
          searchId: buscaAlfa,
          // Presenca digital para que a cadeia lead > pesquisa > lead > presenca > sinal
          // chegue a profundidade 4 e prove o teto (maxDepth = 3).
          withScoreAndPresence: i === 1,
        },
        etapasAlfa,
      ),
    );
  }

  // Filhos do hub: recriados do zero, para o teste de paginacao ter numeros fixos.
  await prisma.leadNote.deleteMany({ where: { leadId: hubId } });
  await prisma.leadActivity.deleteMany({ where: { leadId: hubId } });
  await prisma.leadContactRecord.deleteMany({ where: { leadId: hubId } });
  await prisma.leadFollowUp.deleteMany({ where: { leadId: hubId } });

  await prisma.leadNote.createMany({
    data: Array.from({ length: NOTAS_DO_HUB }, (_, i) => ({
      tenantId: alfa.id,
      leadId: hubId,
      authorId: alfaOwner.id,
      content: `Nota E2E Alfa ${String(i + 1).padStart(2, '0')}`,
      createdAt: daysAgo(NOTAS_DO_HUB - i),
    })),
  });
  await prisma.leadActivity.createMany({
    data: Array.from({ length: ATIVIDADES_DO_HUB }, (_, i) => ({
      tenantId: alfa.id,
      leadId: hubId,
      actorId: alfaOwner.id,
      type: 'CONTACT_REGISTERED' as const,
      metadata: { e2e: true } as Prisma.InputJsonValue,
      createdAt: daysAgo(ATIVIDADES_DO_HUB - i),
    })),
  });
  await prisma.leadContactRecord.createMany({
    data: [
      {
        tenantId: alfa.id,
        leadId: hubId,
        authorId: alfaOwner.id,
        channel: 'WHATSAPP' as const,
        direction: 'SENT' as const,
        outcome: 'Mensagem E2E entregue',
        occurredAt: daysAgo(2),
      },
      {
        tenantId: alfa.id,
        leadId: hubId,
        authorId: alfaOwner.id,
        channel: 'EMAIL' as const,
        direction: 'RECEIVED' as const,
        outcome: 'Resposta E2E recebida',
        occurredAt: daysAgo(1),
      },
    ],
  });
  await prisma.leadFollowUp.create({
    data: {
      tenantId: alfa.id,
      leadId: hubId,
      ownerId: alfaOwner.id,
      channel: 'WHATSAPP',
      priority: 'MEDIUM',
      status: 'PENDING',
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      notes: 'Follow-up E2E',
    },
  });

  // Lead removido (soft delete): nao pode aparecer, ser contado nem ser raiz de grafo.
  const removidoId = await criarLead(
    {
      chave: 'alfa-removido',
      tenantId: alfa.id,
      name: 'Alfa Removido E2E',
      category: 'Dentista',
      city: 'Sao Paulo',
      stateUf: 'SP',
      // Na MESMA pesquisa do hub: a contagem da pesquisa tem de ignorar o removido.
      searchId: buscaAlfa,
      deletedAt: daysAgo(1),
      withScoreAndPresence: false,
    },
    etapasAlfa,
  );

  // ------------------------------ Beta (tenant isolado) ---------------------
  const beta = await prisma.tenant.upsert({
    where: { slug: BETA_SLUG },
    create: { slug: BETA_SLUG, name: 'Beta Workspace E2E', isDemo: true },
    update: { isDemo: true, deletedAt: null },
  });

  const plano = await prisma.plan.findUnique({ where: { code: 'FREE' } });
  if (!plano) throw new Error('Plano FREE nao existe: rode "pnpm db:seed" antes.');
  await prisma.subscription.upsert({
    where: { tenantId: beta.id },
    create: { tenantId: beta.id, planId: plano.id, status: 'TRIALING' },
    update: { planId: plano.id },
  });
  // Onboarding concluido: login cai no dashboard, nao no wizard.
  await prisma.onboardingState.upsert({
    where: { tenantId: beta.id },
    create: { tenantId: beta.id, currentStep: 5, completedAt: daysAgo(1) },
    update: { completedAt: daysAgo(1) },
  });

  const passwordHash = await argonHash(senhaBeta);
  const userBeta = await prisma.user.upsert({
    where: { email: BETA_EMAIL },
    create: { email: BETA_EMAIL, name: 'Beta Usuario E2E', passwordHash },
    // Senha so na criacao, como no seed. Se o usuario ja existe com outra
    // senha, o login do E2E falha alto em vez de redefini-la em silencio.
    update: { name: 'Beta Usuario E2E', isActive: true, deletedAt: null },
  });
  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: userBeta.id, tenantId: beta.id } },
    create: { userId: userBeta.id, tenantId: beta.id, role: 'OWNER', isDefault: true },
    update: { role: 'OWNER', isDefault: true, deletedAt: null },
  });

  const etapasBeta = await etapas(beta.id);
  const buscaBeta = await pesquisa(beta.id, 'Pesquisa E2E Beta', 'Campinas');

  const betaHubId = await criarLead(
    {
      chave: 'beta-hub',
      tenantId: beta.id,
      name: 'Beta Exclusiva Cardio E2E',
      category: 'Dentista',
      city: 'Campinas',
      stateUf: 'SP',
      searchId: buscaBeta,
      stageSlug: 'novo',
      ownerId: userBeta.id,
      withScoreAndPresence: true,
    },
    etapasBeta,
  );
  const betaSegundoId = await criarLead(
    {
      chave: 'beta-segundo',
      tenantId: beta.id,
      name: 'Beta Exclusiva Podologia E2E',
      category: 'Dentista',
      city: 'Campinas',
      stateUf: 'SP',
      searchId: buscaBeta,
      withScoreAndPresence: false,
    },
    etapasBeta,
  );
  await prisma.leadNote.deleteMany({ where: { leadId: betaHubId } });
  await prisma.leadNote.createMany({
    data: [1, 2, 3].map((n) => ({
      tenantId: beta.id,
      leadId: betaHubId,
      authorId: userBeta.id,
      content: `Nota E2E Beta ${String(n).padStart(2, '0')}`,
    })),
  });

  // ------------------------------ Manifesto ---------------------------------
  const manifesto = {
    gerado_em: new Date().toISOString(),
    alfa: {
      tenantId: alfa.id,
      email: owner.email,
      hub: { id: hubId, name: 'Alfa Hub Relacional E2E' },
      satelites: satelites.map((id, i) => ({ id, name: `Alfa Satelite E2E ${String(i + 1).padStart(2, '0')}` })),
      removido: { id: removidoId, name: 'Alfa Removido E2E' },
      notas: NOTAS_DO_HUB,
      atividades: ATIVIDADES_DO_HUB,
      contatos: 2,
      followUps: 1,
      leadsNaPesquisa: SATELITES + 1,
    },
    beta: {
      tenantId: beta.id,
      email: BETA_EMAIL,
      hub: { id: betaHubId, name: 'Beta Exclusiva Cardio E2E' },
      segundo: { id: betaSegundoId, name: 'Beta Exclusiva Podologia E2E' },
      notas: 3,
    },
  };

  fs.mkdirSync(path.dirname(MANIFESTO), { recursive: true });
  fs.writeFileSync(MANIFESTO, `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8');

  console.log(
    `[e2e-fixtures] ok: Alfa hub + ${SATELITES} satelites + ${NOTAS_DO_HUB} notas; Beta com 2 leads. Manifesto em ${path.relative(process.cwd(), MANIFESTO)}`,
  );
}

main()
  .catch((e: unknown) => {
    console.error('[e2e-fixtures] falhou:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
