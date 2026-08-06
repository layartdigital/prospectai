import { createHash } from 'node:crypto';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { fingerprintInput } from '@propectai/types';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Invariantes de multi-tenancy.
 *
 * São as regras que, se quebrarem, vazam dado de um cliente para outro —
 * o pior defeito possível num SaaS. Testadas contra o banco real, porque
 * metade delas é garantida por índice do PostgreSQL, não por código.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const prisma = new PrismaClient();

const suffix = Date.now().toString(36);
const slugA = `test-a-${suffix}`;
const slugB = `test-b-${suffix}`;

let tenantA = '';
let tenantB = '';

function fingerprint(name: string, phone: string | null, postal: string | null): string {
  return createHash('sha256').update(fingerprintInput(name, phone, postal)).digest('hex');
}

// Timeout generoso de propósito: a primeira conexão do Prisma inicializa o
// engine nativo, o que passa de 5 segundos no Windows. O padrão do Jest
// derrubaria o hook antes de o banco sequer responder.
const DB_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  // Conexão explícita antes de qualquer escrita, para que o custo de subir
  // o engine não seja cobrado do primeiro insert.
  await prisma.$connect();

  const a = await prisma.tenant.create({
    data: { name: 'Tenant A (teste)', slug: slugA, isDemo: true },
  });
  const b = await prisma.tenant.create({
    data: { name: 'Tenant B (teste)', slug: slugB, isDemo: true },
  });

  tenantA = a.id;
  tenantB = b.id;
}, DB_TIMEOUT_MS);

afterAll(async () => {
  // Cascade remove leads, scores e o resto junto.
  await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
  await prisma.$disconnect();
}, DB_TIMEOUT_MS);

describe('isolamento entre tenants', () => {
  it('não devolve lead de outro tenant mesmo com o id correto', async () => {
    const fp = fingerprint('Empresa Isolada', '+5511900000001', '01001-000');

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenantB,
        name: 'Empresa Isolada',
        fingerprint: fp,
        websiteStatus: 'SEM_SITE',
      },
    });

    // É assim que o LeadsService busca: id + tenantId, sempre juntos.
    // Conhecer o id não basta.
    const asTenantA = await prisma.lead.findFirst({
      where: { id: lead.id, tenantId: tenantA, deletedAt: null },
    });

    expect(asTenantA).toBeNull();

    const asTenantB = await prisma.lead.findFirst({
      where: { id: lead.id, tenantId: tenantB, deletedAt: null },
    });

    expect(asTenantB?.id).toBe(lead.id);
  });

  it('permite o mesmo negócio em dois tenants sem colidir', async () => {
    // Dois clientes podem prospectar a mesma empresa. O índice único é
    // composto com tenantId justamente para isso.
    const fp = fingerprint('Empresa Compartilhada', '+5511900000002', '01002-000');

    const inA = await prisma.lead.create({
      data: {
        tenantId: tenantA,
        name: 'Empresa Compartilhada',
        fingerprint: fp,
        placeId: `shared-place-${suffix}`,
        websiteStatus: 'SEM_SITE',
      },
    });

    const inB = await prisma.lead.create({
      data: {
        tenantId: tenantB,
        name: 'Empresa Compartilhada',
        fingerprint: fp,
        placeId: `shared-place-${suffix}`,
        websiteStatus: 'SEM_SITE',
      },
    });

    expect(inA.id).not.toBe(inB.id);
  });

  it('impede o mesmo lead duas vezes no mesmo tenant', async () => {
    const fp = fingerprint('Empresa Duplicada', '+5511900000003', '01003-000');

    await prisma.lead.create({
      data: {
        tenantId: tenantA,
        name: 'Empresa Duplicada',
        fingerprint: fp,
        websiteStatus: 'SEM_SITE',
      },
    });

    // O banco recusa. A deduplicação do worker é a primeira barreira;
    // o índice único é a que não falha.
    await expect(
      prisma.lead.create({
        data: {
          tenantId: tenantA,
          name: 'Empresa Duplicada',
          fingerprint: fp,
          websiteStatus: 'SEM_SITE',
        },
      }),
    ).rejects.toThrow();
  });

  it('mantém a chave de idempotência única por tenant', async () => {
    const search = async (tenantId: string) =>
      prisma.prospectingSearch.create({
        data: { tenantId, niche: 'Dentistas', stateUf: 'SP', city: 'São Paulo' },
      });

    const searchA = await search(tenantA);
    const searchB = await search(tenantB);
    const key = `idem-${suffix}`;

    // A mesma chave em tenants diferentes é legítima.
    await prisma.scrapeJob.create({
      data: {
        tenantId: tenantA,
        searchId: searchA.id,
        idempotencyKey: key,
        keyword: 'Dentistas em São Paulo, SP',
      },
    });

    await prisma.scrapeJob.create({
      data: {
        tenantId: tenantB,
        searchId: searchB.id,
        idempotencyKey: key,
        keyword: 'Dentistas em São Paulo, SP',
      },
    });

    // Repetir dentro do mesmo tenant é que não pode — é o que impede
    // cobrar duas vezes pela mesma busca.
    await expect(
      prisma.scrapeJob.create({
        data: {
          tenantId: tenantA,
          searchId: searchA.id,
          idempotencyKey: key,
          keyword: 'Dentistas em São Paulo, SP',
        },
      }),
    ).rejects.toThrow();
  });

  it('não vaza contagem de leads entre tenants', async () => {
    const countA = await prisma.lead.count({ where: { tenantId: tenantA } });
    const countB = await prisma.lead.count({ where: { tenantId: tenantB } });
    const total = await prisma.lead.count({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });

    expect(countA + countB).toBe(total);
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBeGreaterThan(0);
  });
});
