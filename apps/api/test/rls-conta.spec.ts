import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrismaSistemaService } from '../src/prisma/prisma-sistema.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Isolamento da familia Conta e cobranca, provado pelo banco.
 *
 * Cinco tabelas: `memberships`, `subscriptions`, `plan_usages`, `invoices` e
 * `onboarding_states`. `billing_events` **nao** entra — nao tem `tenantId`, por
 * desenho documentado no schema.
 *
 * ---
 *
 * **Dois testes existem so aqui, e sao a razao do arquivo.**
 *
 * 1. "o guard atravessa por desenho" — esta e a primeira familia em que um
 *    caminho legitimo do produto **precisa** ignorar a politica. Ver o bloco.
 *
 * 2. "o upsert de fatura recusa em vez de sobrescrever" — a chave unica de
 *    `invoices` nao inclui `tenantId`, e a politica muda o que acontece quando
 *    o tenant e resolvido errado. Ver o bloco.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate`, `DATABASE_URL_APP` no `.env`
 * e **`pnpm db:seed`** — o cenario precisa de um `Plan`, que e catalogo global
 * e fica fora desta familia. Criar um plano aqui poluiria o catalogo real com
 * uma linha de teste que nao cai por cascade de tenant nenhum.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;
let sistema: PrismaSistemaService;

let tenantA = '';
let tenantB = '';
let usuarioA = '';
let assinaturaA = '';
let faturaA = '';
const externalIdA = `in_teste_${sufixo}`;

const TIMEOUT_MS = 60_000;

const inicioPeriodo = new Date('2026-09-01T00:00:00.000Z');
const fimPeriodo = new Date('2026-09-30T23:59:59.000Z');

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  userId: string;
  assinaturaId: string;
  faturaId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Conta ${rotulo} ${sufixo}`,
      slug: `conta-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const user = await admin.user.create({
    data: {
      email: `conta-${rotulo}-${sufixo}@teste.propectai.local`,
      name: `Dono ${rotulo}`,
      // Hash literal: este arquivo nunca autentica, e rodar Argon2 duas vezes
      // por execucao custaria mais do que tudo o mais junto.
      passwordHash: 'nao-usado-neste-arquivo',
    },
  });

  await admin.membership.create({
    data: { userId: user.id, tenantId: t.id, role: 'OWNER', isDefault: true },
  });

  // O plano e catalogo global e fica fora da familia. Vem do seed.
  const plano = await admin.plan.findFirstOrThrow({ orderBy: { priceCents: 'asc' } });

  const assinatura = await admin.subscription.create({
    data: { tenantId: t.id, planId: plano.id, status: 'ACTIVE' },
  });

  await admin.planUsage.create({
    data: {
      tenantId: t.id,
      periodStart: inicioPeriodo,
      periodEnd: fimPeriodo,
      leadsSettled: 10,
    },
  });

  await admin.onboardingState.create({ data: { tenantId: t.id } });

  const fatura = await admin.invoice.create({
    data: {
      tenantId: t.id,
      externalId: `in_teste_${rotulo}_${sufixo}`,
      status: 'PAID',
      amountCents: 9900,
      amountPaidCents: 9900,
    },
  });

  return {
    tenantId: t.id,
    userId: user.id,
    assinaturaId: assinatura.id,
    faturaId: fatura.id,
  };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  sistema = app.get(PrismaSistemaService);

  const a = await montarTenant('a');
  const b = await montarTenant('b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  usuarioA = a.userId;
  assinaturaA = a.assinaturaId;
  faturaA = a.faturaId;

  // A fatura do teste do `upsert`, com um externalId proprio.
  await admin.invoice.create({
    data: { tenantId: tenantA, externalId: externalIdA, amountCents: 100 },
  });
}, TIMEOUT_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  // `users` e global e nao cai por cascade do tenant.
  await admin.user
    .deleteMany({ where: { email: { contains: `-${sufixo}@teste.propectai.local` } } })
    .catch(() => {});
  await admin.$disconnect();
  await app.close();
}, TIMEOUT_MS);

describe('pre-condicao', () => {
  it('a API nao esta conectada como dono das tabelas', async () => {
    const linhas = await prisma.$queryRaw<Array<{ usuario: string }>>`
      SELECT current_user AS usuario`;
    expect(linhas[0]?.usuario).toBe('propectai_app');
  });
});

describe('leitura sem contexto de tenant', () => {
  it('as cinco tabelas devolvem zero — com denominador', async () => {
    expect(
      await admin.membership.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);
    expect(
      await admin.subscription.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);

    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.planUsage.count()).toBe(0);
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.onboardingState.count()).toBe(0);
  });
});

/**
 * **O guard atravessa por desenho — e esta e a primeira familia onde isso
 * aparece.**
 *
 * O `TenantGuard` le `memberships` para descobrir de qual tenant e a requisicao.
 * Ele nao pode ler sob o contexto do tenant: o contexto e justamente o que ele
 * esta tentando estabelecer. Por isso ele usa o `PrismaSistemaService`, que
 * conecta pelo papel `propectai_sistema` (`BYPASSRLS`).
 *
 * **Isso nao e um furo.** A autorizacao ali nunca esteve na politica: esta no
 * `where` sobre o `userId` que veio do JWT. A politica protege o dado de quem ja
 * esta dentro; o guard decide quem entra.
 *
 * O teste abaixo fixa as duas metades ao mesmo tempo — o papel comum **nao** ve,
 * o papel do sistema **ve**. Fixar so a primeira deixaria passar o dia em que o
 * guard fosse trocado por engano para o cliente comum: as requisicoes
 * comecariam a responder 403 sem explicacao, e o teste continuaria verde.
 */
describe('o guard atravessa por desenho', () => {
  it('sem contexto, o papel da aplicacao nao ve o vinculo', async () => {
    const vistos = await prisma.membership.findMany({ where: { userId: usuarioA } });
    expect(vistos).toHaveLength(0);
  });

  it('e o papel do sistema ve — que e como o guard descobre o tenant', async () => {
    const vistos = await sistema.atravessandoTenants(
      'teste: o guard resolve o tenant antes de haver contexto',
      (db) => db.membership.findMany({ where: { userId: usuarioA } }),
    );

    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.tenantId).toBe(tenantA);
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca a assinatura do A, nem sabendo o id', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.subscription.findMany({ where: { id: assinaturaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem pelo tenantId, que e chave unica da tabela', async () => {
    // `subscriptions.tenantId` e `@unique`, entao o caminho natural e
    // `findUnique({ where: { tenantId } })`. Do contexto errado ele devolve
    // nulo — nao erro. E o modo de falha que sempre precisa de teste.
    const uma = await prisma.comTenant(tenantB, (tx) =>
      tx.subscription.findUnique({ where: { tenantId: tenantA } }),
    );
    expect(uma).toBeNull();
  });

  it('nem a fatura', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.invoice.findMany({ where: { id: faturaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga as tres', async () => {
    const { assinaturas, faturas, consumos } = await prisma.comTenant(tenantA, async (tx) => ({
      assinaturas: await tx.subscription.findMany({ where: { id: assinaturaA } }),
      faturas: await tx.invoice.findMany({ where: { id: faturaA } }),
      consumos: await tx.planUsage.findMany({ where: { tenantId: tenantA } }),
    }));
    expect(assinaturas).toHaveLength(1);
    expect(faturas).toHaveLength(1);
    expect(consumos).toHaveLength(1);
  });
});

describe('WITH CHECK', () => {
  it('criar vinculo com o tenantId do vizinho e recusado', async () => {
    // O caso mais grave desta familia: um `membership` forjado e acesso ao
    // workspace inteiro, nao a uma linha.
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.membership.create({
          data: { userId: usuarioA, tenantId: tenantA, role: 'OWNER' },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.membership.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('mexer na cota do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. Contagem zero distingue, e a leitura seguinte confirma.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.planUsage.updateMany({
        where: { tenantId: tenantA },
        data: { leadsSettled: 999 },
      }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.planUsage.findFirstOrThrow({ where: { tenantId: tenantA } });
    expect(depois.leadsSettled).toBe(10);
  });
});

/**
 * **O `upsert` de fatura recusa em vez de sobrescrever.**
 *
 * `invoices` tem `@@unique([provider, externalId])` — sem `tenantId`. O
 * `billing.service.ts` faz `upsert` por essa chave, porque e a chave de
 * idempotencia que o provedor entrega.
 *
 * Antes da politica, um tenant resolvido errado encontraria a fatura do vizinho
 * e a **sobrescreveria em silencio**. Agora a clausula `USING` esconde a linha,
 * o `upsert` cai no ramo `create`, e a restricao unica — que roda por fora do
 * RLS, por desenho do Postgres — recusa.
 *
 * Corrupcao silenciosa virou erro barulhento no mesmo ponto. O teste fixa isso
 * porque a violacao de chave no log e facil de ler como defeito do `upsert`,
 * quando ela e o sintoma certo de um problema anterior: a resolucao do tenant.
 */
describe('o upsert de fatura recusa em vez de sobrescrever', () => {
  it('do contexto errado, a chave unica barra o que a politica escondeu', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.invoice.upsert({
          where: { provider_externalId: { provider: 'stripe', externalId: externalIdA } },
          create: { tenantId: tenantB, externalId: externalIdA, amountCents: 777 },
          update: { amountCents: 777 },
        }),
      ),
    ).rejects.toThrow();

    // A fatura do A continua como estava — nao foi sobrescrita nem duplicada.
    const dela = await admin.invoice.findUniqueOrThrow({
      where: { provider_externalId: { provider: 'stripe', externalId: externalIdA } },
    });
    expect(dela.tenantId).toBe(tenantA);
    expect(dela.amountCents).toBe(100);
  });

  it('do contexto certo, o mesmo upsert atualiza', async () => {
    // O contraponto: sem ele, "lancou" seria a resposta certa pelo motivo
    // errado — um `upsert` quebrado lancaria dos dois lados.
    const r = await prisma.comTenant(tenantA, (tx) =>
      tx.invoice.upsert({
        where: { provider_externalId: { provider: 'stripe', externalId: externalIdA } },
        create: { tenantId: tenantA, externalId: externalIdA, amountCents: 555 },
        update: { amountCents: 555 },
      }),
    );

    expect(r.amountCents).toBe(555);
  });
});
