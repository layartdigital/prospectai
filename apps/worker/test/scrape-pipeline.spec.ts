import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import type { LeadSourceProvider } from '@propectai/types';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MockLeadSourceProvider } from '../src/providers/mock.provider';
import { processScrapeJob } from '../src/pipeline/process-scrape-job';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Regras comerciais 5.3 e 5.4 do escopo — prova de COMPORTAMENTO.
 *
 * Complementa business-invariants.spec.ts na API, que varre o estado do banco.
 * Aquele é rede permanente e passa trivialmente em banco vazio; este roda o
 * ciclo de verdade: mesma busca duas vezes, e uma falha forçada.
 *
 * O que se prova aqui:
 *   - lead novo consome cota, duplicado não
 *   - job que falha devolve toda a reserva
 *   - nenhum lead de job concluído fica sem score e sem motivo
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

const REQUESTED = 10;

/**
 * Pedido que faz o mock devolver mais de um resultado.
 *
 * `maxDepth` sai de `ceil(requestedCount / 20)` e o mock trata profundidade
 * como quantidade — 10 pedidos viram 1 lead. Para exercitar o limiar de
 * validação é preciso passar do primeiro múltiplo: 100 devolve 5.
 */
const REQUESTED_LARGO = 100;
const RESULTADOS_LARGO = 5;

let tenantId = '';
let searchId = '';
let segmentId = '';

/** Mesma definição de período usada pelo pipeline: 1º do mês, hora local. */
function periodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function usage(): Promise<{ reserved: number; settled: number }> {
  const row = await prisma.planUsage.findUniqueOrThrow({
    where: { tenantId_periodStart: { tenantId, periodStart: periodStart() } },
  });
  return { reserved: row.leadsReserved, settled: row.leadsSettled };
}

/** Reserva a cota como a API faz ao enfileirar, e cria o job correspondente. */
async function enqueue(
  label: string,
  count = REQUESTED,
  alvo = searchId,
): Promise<string> {
  await prisma.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: periodStart() } },
    data: { leadsReserved: { increment: count }, searchesCount: { increment: 1 } },
  });

  const job = await prisma.scrapeJob.create({
    data: {
      tenantId,
      searchId: alvo,
      keyword: 'Dentistas em São Paulo, SP',
      idempotencyKey: `${suffix}-${label}`,
      status: 'QUEUED',
    },
  });

  return job.id;
}

function payload(scrapeJobId: string, count = REQUESTED, alvo = searchId) {
  return {
    tenantId,
    searchId: alvo,
    scrapeJobId,
    // Mesma palavra-chave em todos os jobs de propósito: o mock gera títulos
    // determinísticos a partir dela, e é isso que faz a deduplicação por
    // fingerprint acontecer entre execuções.
    keyword: 'Dentistas em São Paulo, SP',
    requestedCount: count,
    radiusKm: 10,
  };
}

/**
 * Cria um locale de teste com o status pedido.
 *
 * Locale inventado (`xx-*`, país `XX`) para não colidir com dado real nem com
 * outra execução da suíte — a chave é única por segmento e idioma.
 */
async function criarLocale(
  status: 'GERADO' | 'VALIDADO' | 'CURADO',
  chave: string,
): Promise<string> {
  const locale = await prisma.segmentLocale.create({
    data: {
      segmentId,
      locale: `xx-${chave}`,
      country: 'XX',
      label: 'Dentistas',
      searchTerms: ['dentista'],
      status,
    },
  });

  return locale.id;
}

/** Busca que declara ter saído de um termo sugerido. */
async function buscaComTermo(segmentLocaleId: string): Promise<string> {
  const search = await prisma.prospectingSearch.create({
    data: {
      tenantId,
      niche: 'Dentistas',
      stateUf: 'SP',
      city: 'São Paulo',
      segmentLocaleId,
    },
  });

  return search.id;
}

beforeAll(async () => {
  await prisma.$connect();

  const tenant = await prisma.tenant.create({
    data: { name: `Tenant Pipeline ${suffix}`, slug: `pipeline-${suffix}`, isDemo: true },
  });
  tenantId = tenant.id;

  const search = await prisma.prospectingSearch.create({
    data: { tenantId, niche: 'Dentistas', stateUf: 'SP', city: 'São Paulo' },
  });
  searchId = search.id;

  const start = periodStart();
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

  await prisma.planUsage.create({
    data: { tenantId, periodStart: start, periodEnd: end },
  });

  // Segmento é global, não pertence a tenant nenhum — por isso sai na limpeza
  // por conta própria, e não de carona no cascade do tenant.
  const segment = await prisma.segment.create({
    data: {
      externalId: `TEST-${suffix}`,
      macroSegment: 'Teste',
      name: `Segmento Pipeline ${suffix}`,
      services: [],
      targetSectors: [],
      opportunitySignals: [],
      isActive: false,
    },
  });
  segmentId = segment.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.segment.deleteMany({ where: { id: segmentId } });
  await prisma.$disconnect();
});

describe('regra 5.3 — cota', () => {
  it('primeira busca cobra apenas pelos leads novos e zera a reserva', async () => {
    const provider = new MockLeadSourceProvider();
    const jobId = await enqueue('primeira');

    const antes = await usage();
    expect(antes.reserved).toBe(REQUESTED);

    const result = await processScrapeJob(prisma, provider, payload(jobId));

    expect(result.newLeads).toBeGreaterThan(0);
    expect(result.duplicates).toBe(0);

    const depois = await usage();
    // A reserva é liquidada por inteiro; o consumo é só o que virou lead novo.
    expect(depois.reserved).toBe(0);
    expect(depois.settled).toBe(result.newLeads);
  });

  it('repetir a mesma busca não duplica lead nem cobra de novo', async () => {
    const provider = new MockLeadSourceProvider();
    const jobId = await enqueue('repetida');

    const antes = await usage();
    const result = await processScrapeJob(prisma, provider, payload(jobId));

    // O mock gera place_id novo a cada job; a deduplicação aqui acontece pelo
    // fingerprint (nome + telefone + CEP), que é o caminho que de fato protege
    // quando a fonte não devolve identificador estável.
    expect(result.newLeads).toBe(0);
    expect(result.duplicates).toBeGreaterThan(0);

    const depois = await usage();
    expect(depois.reserved).toBe(0);
    expect(depois.settled).toBe(antes.settled);

    const total = await prisma.lead.count({ where: { tenantId } });
    expect(total).toBe(antes.settled);
  });

  it('job que falha devolve toda a reserva', async () => {
    const quebrado: LeadSourceProvider = {
      name: 'quebrado',
      createSearch: async () => {
        throw new Error('Fonte indisponível');
      },
      getJob: async () => {
        throw new Error('Fonte indisponível');
      },
      getResults: async () => [],
      cancelJob: async () => undefined,
    };

    const jobId = await enqueue('falha');
    const antes = await usage();
    expect(antes.reserved).toBe(REQUESTED);

    await expect(
      processScrapeJob(prisma, quebrado, payload(jobId)),
    ).rejects.toThrow();

    const depois = await usage();
    expect(depois.reserved).toBe(0);
    // Falhar não pode consumir crédito nem, pior, gerar crédito.
    expect(depois.settled).toBe(antes.settled);

    const job = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('FAILED');
  });
});

describe('regra 5.4 — nenhum lead concluído sem score explicado', () => {
  it('todo lead criado pelo pipeline tem score e motivos', async () => {
    const leads = await prisma.lead.findMany({
      where: { tenantId },
      include: { score: { include: { reasons: true } } },
    });

    expect(leads.length).toBeGreaterThan(0);

    const semScore = leads.filter((lead) => !lead.score);
    const semMotivo = leads.filter(
      (lead) => lead.score && lead.score.reasons.length === 0,
    );

    expect(semScore.map((lead) => lead.name)).toEqual([]);
    expect(semMotivo.map((lead) => lead.name)).toEqual([]);
  });

  it('nenhum dado pessoal de avaliador foi persistido', async () => {
    // Regra 5.5, verificada no mesmo ciclo: o payload bruto gravado em
    // LeadSourceRecord não pode conter os campos de pessoa física.
    const records = await prisma.leadSourceRecord.findMany({
      where: { tenantId },
      select: { payload: true },
      take: 50,
    });

    for (const record of records) {
      const serialized = JSON.stringify(record.payload ?? {});
      expect(serialized).not.toContain('user_reviews');
      expect(serialized).not.toContain('"owner"');
    }
  });
});

/**
 * Veredito sobre termo sugerido pela taxonomia.
 *
 * Este bloco existe porque o custo de errar aqui não é local: o status de um
 * `SegmentLocale` é global ao país, não ao tenant. Um bug que promove termo
 * ruim faz todos os próximos clientes daquele país começarem com busca vazia;
 * um bug que rebaixa termo bom apaga curadoria humana. Nos dois casos o
 * sintoma aparece longe da causa, semanas depois.
 */
describe('validação de termos por busca real', () => {
  it('resultado suficiente promove GERADO para VALIDADO', async () => {
    const localeId = await criarLocale('GERADO', `ok-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-ok', REQUESTED_LARGO, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED_LARGO, alvo));

    const locale = await prisma.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    expect(locale.status).toBe('VALIDADO');
    expect(locale.resultCount).toBe(RESULTADOS_LARGO);
    expect(locale.validatedAt).not.toBeNull();
  });

  it('valida mesmo quando todos os resultados são duplicados', async () => {
    // O guarda mais importante do bloco. Contar `createdLeadIds.length` em vez
    // de `rawLeads.length` passaria em tudo, menos aqui: um termo perfeito
    // rodado sobre base já coletada devolve zero leads novos e seria reprovado.
    // Encontrar empresa é o que o termo tem de provar; ser inédita, não.
    const localeId = await criarLocale('GERADO', `dup-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-dup', REQUESTED_LARGO, alvo);

    const provider = new MockLeadSourceProvider();
    const resultado = await processScrapeJob(
      prisma,
      provider,
      payload(jobId, REQUESTED_LARGO, alvo),
    );

    expect(resultado.newLeads).toBe(0);
    expect(resultado.duplicates).toBe(RESULTADOS_LARGO);

    const locale = await prisma.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    expect(locale.status).toBe('VALIDADO');
    expect(locale.resultCount).toBe(RESULTADOS_LARGO);
  });

  it('resultado insuficiente registra a contagem sem apagar o termo', async () => {
    const localeId = await criarLocale('GERADO', `poucos-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-poucos', REQUESTED, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED, alvo));

    const locale = await prisma.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    // Continua sob suspeita, e continua utilizável: uma cidade sem esse tipo
    // de negócio não é prova contra o termo. A contagem fica registrada para
    // que o padrão apareça se ele falhar em várias.
    expect(locale.status).toBe('GERADO');
    expect(locale.resultCount).toBe(1);
    expect(locale.validatedAt).toBeNull();
  });

  it('termo CURADO não é rebaixado por busca fraca', async () => {
    const localeId = await criarLocale('CURADO', `curado-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-curado', REQUESTED, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED, alvo));

    const locale = await prisma.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    // Revisão humana não é revogada por estatística de uma cidade. O `null` em
    // resultCount é parte da afirmação: o veredito nem chegou a ser calculado.
    expect(locale.status).toBe('CURADO');
    expect(locale.resultCount).toBeNull();
  });

  it('busca sem termo sugerido não altera locale nenhum', async () => {
    const antes = await prisma.segmentLocale.findMany({
      where: { segmentId },
      orderBy: { locale: 'asc' },
      select: { locale: true, status: true, resultCount: true },
    });

    const jobId = await enqueue('veredito-ausente');
    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId));

    const depois = await prisma.segmentLocale.findMany({
      where: { segmentId },
      orderBy: { locale: 'asc' },
      select: { locale: true, status: true, resultCount: true },
    });

    expect(depois).toEqual(antes);
  });
});
