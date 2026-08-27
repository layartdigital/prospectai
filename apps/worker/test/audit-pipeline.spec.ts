import { createHash } from 'node:crypto';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import type { SiteAuditProvider } from '@propectai/types';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processAuditJob } from '../src/pipeline/process-audit-job';
import { criarPrismaAdmin } from './prisma-admin';
import { MockSiteAuditProvider } from '../src/providers/site-audit/mock.provider';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Pipeline de auditoria — prova de COMPORTAMENTO contra o banco.
 *
 * A metade que roda sem Postgres esta em `audit-decisoes.spec.ts`: a decisao de
 * recusar mensagem forjada e replay. Aqui se prova a outra metade, a que so o
 * banco pode mostrar — que **a chave composta impede alcancar a auditoria do
 * vizinho**, e que a cota volta quando a medicao nao acontece.
 *
 * Medicoes S12, S12b e S13 da `SECURITY-EGRESS-POLICY-v3.md` §4.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

/**
 * **Dois clients, com papeis diferentes — e a separacao e o ponto.**
 *
 * `admin` monta o cenario e confere o resultado. Montar cenario e operacao
 * administrativa; nao faz sentido submete-la a politica que se quer testar.
 *
 * `prisma` e o que o codigo sob teste recebe. Quando o passo 4 do
 * `PLANO-RLS-v1.md` apontar o `DATABASE_URL` para o papel `propectai_app`, ele
 * vira o papel da aplicacao **sem uma linha mudar aqui** — e so entao S13
 * comeca a provar a politica do banco, e nao apenas a chave composta.
 *
 * Hoje os dois apontam para o mesmo lugar e nada muda. E essa e a ideia: o
 * passo que troca o papel nao pode ser o mesmo que reescreve as fixtures,
 * senao uma falha nao diz qual dos dois a causou.
 */
const admin = criarPrismaAdmin();
const prisma = new PrismaClient();
const sufixo = Date.now().toString(36);

/** Ver a nota extensa no `scrape-pipeline.spec.ts`: e ambiente, nao regressao. */
const TIMEOUT_HOOK_MS = 60_000;

let tenantA = '';
let tenantB = '';
let leadA = '';
let leadSemSite = '';

function inicioDoPeriodo(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

async function criarTenant(rotulo: string): Promise<string> {
  const t = await admin.tenant.create({
    data: { name: `Tenant Audit ${rotulo} ${sufixo}`, slug: `audit-${rotulo}-${sufixo}`, isDemo: true },
  });
  const inicio = inicioDoPeriodo();
  await admin.planUsage.create({
    data: {
      tenantId: t.id,
      periodStart: inicio,
      periodEnd: new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1),
    },
  });
  return t.id;
}

async function criarLead(tenantId: string, website: string | null, rotulo: string): Promise<string> {
  const lead = await admin.lead.create({
    data: {
      tenantId,
      name: `Negocio ${rotulo} ${sufixo}`,
      website,
      fingerprint: createHash('sha256').update(`${tenantId}-${rotulo}-${sufixo}`).digest('hex'),
    },
  });
  return lead.id;
}

/** Cria a auditoria como a API faz ao enfileirar: cota ja consumida. */
async function pedirAuditoria(tenantId: string, leadId: string): Promise<string> {
  await admin.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: inicioDoPeriodo() } },
    data: { auditsCount: { increment: 1 } },
  });
  const a = await admin.digitalPresenceAudit.create({
    data: { tenantId, leadId, auditVersion: 'audit-v1', status: 'QUEUED' },
  });
  return a.id;
}

async function creditos(tenantId: string): Promise<number> {
  const row = await admin.planUsage.findUniqueOrThrow({
    where: { tenantId_periodStart: { tenantId, periodStart: inicioDoPeriodo() } },
  });
  return row.auditsCount;
}

const mock = new MockSiteAuditProvider();

/** Provider que sempre quebra, para o caminho de falha nossa. */
const quebrado: SiteAuditProvider = {
  name: 'quebrado',
  auditar: async () => {
    throw new Error('provider fora do ar');
  },
};

beforeAll(async () => {
  await Promise.all([admin.$connect(), prisma.$connect()]);
  tenantA = await criarTenant('a');
  tenantB = await criarTenant('b');
  leadA = await criarLead(tenantA, 'https://exemplo-auditoria.com.br', 'com-site');
  leadSemSite = await criarLead(tenantA, null, 'sem-site');
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  await Promise.all([admin.$disconnect(), prisma.$disconnect()]);
}, TIMEOUT_HOOK_MS);

describe('caminho feliz', () => {
  it('grava as checagens e finaliza sem devolver cota', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    const antes = await creditos(tenantA);

    const r = await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:1`, ultimaTentativa: false },
    );

    expect(r.executou).toBe(true);
    expect(r.checks).toBe(4);

    const gravada = await admin.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantA, id: auditId } },
      include: { checks: true },
    });
    expect(gravada.checks.length).toBe(4);
    expect(gravada.queueJobId).toBe(`bull:${sufixo}:1`);
    expect(gravada.finishedAt === null).toBe(false);
    // A medicao aconteceu: o credito foi consumido por trabalho entregue.
    expect(await creditos(tenantA)).toBe(antes);
  });

  it('grava QUEM mediu, e nao so o que foi medido', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:prov`, ultimaTentativa: false },
    );

    const gravada = await admin.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantA, id: auditId } },
    });

    // Sem este campo, uma auditoria medida contra a internet e uma inventada
    // pelo mock ficam indistinguiveis no banco — e isso passou despercebido
    // tres vezes, cada uma descoberta so porque alguem reparou num numero.
    expect(gravada.providerName).toBe('mock');
  });

  it('o nome gravado e o do provider que rodou, nao um literal', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    const outro: SiteAuditProvider = {
      name: 'provider-de-teste',
      auditar: async () => ({
        auditVersion: 'audit-v1',
        status: 'COMPLETED' as const,
        checks: [],
        durationMs: 1,
        errorCode: null,
      }),
    };

    await processAuditJob(
      prisma,
      outro,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:prov2`, ultimaTentativa: false },
    );

    const gravada = await admin.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantA, id: auditId } },
    });
    expect(gravada.providerName).toBe('provider-de-teste');
  });

  it('toda checagem sai com prazo de guarda', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:2`, ultimaTentativa: false },
    );

    const checks = await admin.digitalPresenceCheck.findMany({
      where: { tenantId: tenantA, auditId },
    });
    // Sem prazo a tabela cresce sem limite — o defeito que o
    // `LeadSourceRecord.payload` ja tem e que este modelo existe para nao repetir.
    expect(checks.every((c) => c.retentionUntil !== null)).toBe(true);
  });

  it('lead sem website vira FAILED sem gastar credito', async () => {
    const auditId = await pedirAuditoria(tenantA, leadSemSite);
    const antes = await creditos(tenantA);

    const r = await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:3`, ultimaTentativa: true },
    );

    expect(r.status).toBe('FAILED');
    // Regra 4: campo vazio e DESCONHECIDO, nao AUSENTE. Nao ha medicao, entao
    // nao ha o que cobrar.
    expect(await creditos(tenantA)).toBe(antes - 1);
  });
});

describe('S13 — a chave composta impede alcancar o vizinho', () => {
  it('auditoria do tenant A nao e alcancavel com o tenantId de B', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);

    const r = await processAuditJob(
      prisma,
      mock,
      // Payload forjado: id real, tenant errado. Sem chave composta este
      // `findUnique` acharia a auditoria e a executaria sob o tenant errado.
      { tenantId: tenantB, auditId },
      { queueJobId: `bull:${sufixo}:4`, ultimaTentativa: false },
    );

    expect(r.executou).toBe(false);
    expect(r.motivo).toBe('INEXISTENTE');

    const intacta = await admin.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantA, id: auditId } },
    });
    expect(intacta.status).toBe('QUEUED');
    expect(intacta.queueJobId).toBe(null);
  });

  it('nenhuma checagem foi gravada para o tenant errado', async () => {
    const doB = await admin.digitalPresenceCheck.count({ where: { tenantId: tenantB } });
    expect(doB).toBe(0);
  });
});

describe('S12 — mensagem forjada nao executa', () => {
  it('id de fila diferente do reivindicado e recusado', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:5`, ultimaTentativa: false },
    );

    const r = await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: 'forjado:999', ultimaTentativa: false },
    );

    expect(r.executou).toBe(false);
    expect(r.motivo).toBe('JOB_ALHEIO');
  });
});

describe('S12b — replay nao duplica medicao', () => {
  it('a mesma mensagem de volta nao grava checagem nova', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    const jobId = `bull:${sufixo}:6`;

    await processAuditJob(prisma, mock, { tenantId: tenantA, auditId }, { queueJobId: jobId, ultimaTentativa: false });
    const depoisDaPrimeira = await admin.digitalPresenceCheck.count({
      where: { tenantId: tenantA, auditId },
    });

    const r = await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: jobId, ultimaTentativa: false },
    );

    expect(r.executou).toBe(false);
    expect(r.motivo).toBe('JA_FINALIZADA');
    // A garantia que importa: replay nao infla a tabela nem o relatorio.
    expect(await admin.digitalPresenceCheck.count({ where: { tenantId: tenantA, auditId } })).toBe(
      depoisDaPrimeira,
    );
  });
});

describe('falha nossa', () => {
  it('com tentativa sobrando o job levanta, sem estado terminal', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);

    await expect(
      processAuditJob(
        prisma,
        quebrado,
        { tenantId: tenantA, auditId },
        { queueJobId: `bull:${sufixo}:7`, ultimaTentativa: false },
      ),
    ).rejects.toThrow();

    const parcial = await admin.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: tenantA, id: auditId } },
    });
    // Gravar FAILED aqui faria a proxima tentativa bater em JA_FINALIZADA — a
    // guarda de replay mataria o retry que ela nao deveria tocar.
    expect(parcial.status).toBe('RUNNING');
  });

  it('na ultima tentativa persiste FAILED e devolve o credito', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    const antes = await creditos(tenantA);

    const r = await processAuditJob(
      prisma,
      quebrado,
      { tenantId: tenantA, auditId },
      { queueJobId: `bull:${sufixo}:8`, ultimaTentativa: true },
    );

    expect(r.status).toBe('FAILED');
    expect(await creditos(tenantA)).toBe(antes - 1);
  });

  it('o retry seguinte executa, porque o id bate', async () => {
    const auditId = await pedirAuditoria(tenantA, leadA);
    const jobId = `bull:${sufixo}:9`;

    await processAuditJob(prisma, quebrado, { tenantId: tenantA, auditId }, { queueJobId: jobId, ultimaTentativa: false }).catch(
      () => undefined,
    );
    const r = await processAuditJob(
      prisma,
      mock,
      { tenantId: tenantA, auditId },
      { queueJobId: jobId, ultimaTentativa: false },
    );

    expect(r.executou).toBe(true);
    expect(r.status).toBe('COMPLETED');
  });
});

describe('nada da pagina chega ao banco', () => {
  it('nenhuma checagem gravada carrega corpo', async () => {
    const checks = await admin.digitalPresenceCheck.findMany({ where: { tenantId: tenantA } });
    for (const c of checks) {
      const serializado = JSON.stringify(c.result ?? {});
      expect(serializado).not.toContain('<html');
      expect(serializado).not.toContain('<body');
    }
  });

  it('nenhuma URL observada carrega query', async () => {
    const checks = await admin.digitalPresenceCheck.findMany({ where: { tenantId: tenantA } });
    for (const c of checks) {
      if (c.observedUrl === null) continue;
      expect(c.observedUrl).not.toContain('?');
    }
  });
});
