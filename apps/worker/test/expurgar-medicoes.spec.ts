import { createHash } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaApp } from '../src/db/prisma-app';
import { criarPrismaSistema } from '../src/db/prisma-sistema';
import { chaveDeAviso } from '../src/pipeline/audit-decisoes';
import { expurgarMedicoes } from '../src/pipeline/expurgar-medicoes';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Expurgo das medicoes — D6, peca 4. Prova contra o banco.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 *
 * ---
 *
 * **Esta e a unica rotina destrutiva do projeto, e o que ela NAO apaga importa
 * tanto quanto o que apaga.** Por isso os quatro casos abaixo vem em pares: um
 * afirma a exclusao, tres afirmam a recusa — sem aviso registrado, dentro do
 * prazo, e a auditoria em si.
 *
 * Um teste que so provasse "apaga o vencido" passaria igual num expurgo que
 * apaga tudo.
 */

const admin = criarPrismaAdmin();
const sistema = criarPrismaSistema();
const app = criarPrismaApp();

const sufixo = Date.now().toString(36);
const TIMEOUT_HOOK_MS = 60_000;
const DIA_MS = 24 * 60 * 60 * 1000;

const agora = new Date();
const vencida = new Date(agora.getTime() - 10 * DIA_MS);
const noPrazo = new Date(agora.getTime() + 30 * DIA_MS);

let tenantId = '';
let comAviso = '';
let semAviso = '';
let dentroDoPrazo = '';

async function criarLead(rotulo: string): Promise<string> {
  const lead = await admin.lead.create({
    data: {
      tenantId,
      name: `Negocio ${rotulo} ${sufixo}`,
      website: 'https://exemplo.invalid',
      fingerprint: createHash('sha256').update(`${tenantId}-${rotulo}-${sufixo}`).digest('hex'),
    },
  });
  return lead.id;
}

async function criarAuditoria(rotulo: string, prazos: readonly Date[]): Promise<string> {
  const leadId = await criarLead(rotulo);
  const auditoria = await admin.digitalPresenceAudit.create({
    data: { tenantId, leadId, auditVersion: `expurgo-${sufixo}`, providerName: 'mock' },
  });

  await admin.digitalPresenceCheck.createMany({
    data: prazos.map((retentionUntil, indice) => ({
      tenantId,
      auditId: auditoria.id,
      check: indice === 0 ? ('DNS' as const) : ('HTTPS' as const),
      outcome: 'OK' as const,
      retentionUntil,
    })),
  });

  return auditoria.id;
}

/** Registra o aviso como a peca 3 registra: pela chave, e nao pelo texto. */
async function registrarAviso(auditId: string): Promise<void> {
  await admin.notification.create({
    data: {
      tenantId,
      type: 'RETENTION_EXPIRING',
      title: `Aviso de teste ${sufixo}`,
      dedupeKey: chaveDeAviso(auditId),
    },
  });
}

async function checagensDe(auditId: string): Promise<number> {
  return admin.digitalPresenceCheck.count({ where: { auditId } });
}

beforeAll(async () => {
  const tenant = await admin.tenant.create({
    data: { name: `Tenant Expurgo ${sufixo}`, slug: `expurgo-${sufixo}`, isDemo: true },
  });
  tenantId = tenant.id;

  // Duas checagens vencidas, aviso registrado. Este e o unico que deve sumir.
  comAviso = await criarAuditoria('com-aviso', [vencida, vencida]);
  await registrarAviso(comAviso);

  // Vencida do mesmo jeito, e sem aviso. Tem que sobreviver.
  semAviso = await criarAuditoria('sem-aviso', [vencida]);

  // Avisada, mas ainda no prazo. Aviso registrado nao e licenca para apagar.
  dentroDoPrazo = await criarAuditoria('no-prazo', [noPrazo]);
  await registrarAviso(dentroDoPrazo);
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  if (tenantId) {
    await admin.tenant.delete({ where: { id: tenantId } }).catch((erro: unknown) => {
      console.error(`[limpeza] FALHOU: tenant ${tenantId}`, erro);
      throw erro;
    });
  }
  await Promise.all([admin.$disconnect(), sistema.$disconnect(), app.$disconnect()]);
}, TIMEOUT_HOOK_MS);

describe('expurgo das medicoes', () => {
  it('apaga o que venceu E foi avisado, e conta o que adiou', async () => {
    const resultado = await expurgarMedicoes(sistema, app, agora);

    // Contadores sao `>=`: o job varre o banco inteiro, e esta suite nao e dona
    // dele. O que e exato esta nos casos abaixo, por auditoria.
    expect(resultado.checagensApagadas).toBeGreaterThanOrEqual(2);
    expect(resultado.adiadas).toBeGreaterThanOrEqual(1);

    expect(await checagensDe(comAviso)).toBe(0);
  });

  it('nao apaga o vencido sem aviso registrado — adia', async () => {
    /**
     * **O teste que sustenta a peca inteira.**
     *
     * A decisao e explicita: sem essa trava, um defeito no notificador vira
     * perda silenciosa de dado. Se esta linha passar a reprovar, o expurgo
     * deixou de exigir prova — e o sintoma em producao seria um cliente
     * descobrindo que o relatorio sumiu no dia em que foi procura-lo.
     */
    expect(await checagensDe(semAviso)).toBe(1);
  });

  it('aviso registrado nao apaga o que ainda esta no prazo', async () => {
    // A auditoria entra na lista por ter aviso; o que decide linha a linha e o
    // `retentionUntil`. Sem esta assercao, um `deleteMany` por `auditId`
    // sozinho passaria nos outros dois testes.
    expect(await checagensDe(dentroDoPrazo)).toBe(1);
  });

  it('a auditoria fica — some a medicao, nao o registro de que houve medicao', async () => {
    const auditoria = await admin.digitalPresenceAudit.findUnique({ where: { id: comAviso } });
    expect(auditoria).not.toBeNull();
  });

  it('registra no auditLog quantas linhas sairam', async () => {
    // Dado de cliente nao e apagado sem registro de que foi apagado. O registro
    // nasce na mesma transacao da exclusao: se ele falhar, ela volta atras.
    const registros = await admin.auditLog.findMany({
      where: { entityId: comAviso, action: 'audit.checks.purged' },
    });

    expect(registros).toHaveLength(1);
    expect(registros[0]?.before).toEqual({ checagens: 2 });
  });

  it('rodar de novo nao acha mais nada para apagar ali', async () => {
    const resultado = await expurgarMedicoes(sistema, app, agora);

    // O adiado continua adiado — e continua sendo contado, que e como o
    // problema aparece em vez de sumir.
    expect(resultado.adiadas).toBeGreaterThanOrEqual(1);

    expect(await checagensDe(comAviso)).toBe(0);
    expect(await checagensDe(semAviso)).toBe(1);
    expect(
      await admin.auditLog.count({ where: { entityId: comAviso, action: 'audit.checks.purged' } }),
    ).toBe(1);
  });
});
