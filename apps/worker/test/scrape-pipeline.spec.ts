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

let tenantId = '';
let searchId = '';

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
async function enqueue(label: string): Promise<string> {
  await prisma.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: periodStart() } },
    data: { leadsReserved: { increment: REQUESTED }, searchesCount: { increment: 1 } },
  });

  const job = await prisma.scrapeJob.create({
    data: {
      tenantId,
      searchId,
      keyword: 'Dentistas em São Paulo, SP',
      idempotencyKey: `${suffix}-${label}`,
      status: 'QUEUED',
    },
  });

  return job.id;
}

function payload(scrapeJobId: string) {
  return {
    tenantId,
    searchId,
    scrapeJobId,
    keyword: 'Dentistas em São Paulo, SP',
    requestedCount: REQUESTED,
    radiusKm: 10,
  };
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
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
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
