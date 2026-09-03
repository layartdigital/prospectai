import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Isolamento da familia Coleta, provado pelo banco.
 *
 * Molde do `rls-pipeline.spec.ts`, que por sua vez veio do
 * `apps/worker/test/rls-canario.spec.ts`. O client sob teste e o
 * `PrismaService` do proprio Nest — o que se quer provar e que a aplicacao
 * **como ela roda** esta sujeita a politica, e nao que um client montado a mao
 * estaria.
 *
 * ---
 *
 * **O que este arquivo NAO cobre, e onde isso e coberto.**
 *
 * Ele nao exercita o ciclo de coleta. Quem faz isso e o
 * `apps/worker/test/scrape-pipeline.spec.ts`, que roda o `processScrapeJob`
 * inteiro pelo `criarPrismaApp()` — nove blocos `comTenant` separados por
 * sondagem da fonte, cada um declarando o tenant de novo. Aquele arquivo prova
 * que **a politica nao quebra o fluxo**; este prova que **ela isola**.
 *
 * As duas afirmacoes sao diferentes e nenhuma implica a outra: um fluxo pode
 * funcionar inteiro e ainda assim deixar o vizinho ler.
 *
 * ---
 *
 * **A chave de idempotencia nao e testada aqui**, e tambem de proposito. O
 * `tenant-isolation.spec.ts` cobre `(tenantId, idempotencyKey)` pelo papel que
 * ignora a politica — porque o que ele testa e a **restricao unica do banco**,
 * que roda por fora do RLS. Misturar as duas coisas no mesmo arquivo faria uma
 * falha nao dizer qual das duas garantias caiu.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no `.env`.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;

let tenantA = '';
let tenantB = '';
let buscaA = '';
let jobA = '';

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  buscaId: string;
  jobId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Coleta ${rotulo} ${sufixo}`,
      slug: `coleta-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const busca = await admin.prospectingSearch.create({
    data: { tenantId: t.id, niche: 'Dentistas', stateUf: 'SP', city: 'São Paulo' },
  });

  const job = await admin.scrapeJob.create({
    data: {
      tenantId: t.id,
      searchId: busca.id,
      idempotencyKey: `coleta-${rotulo}-${sufixo}`,
      keyword: 'Dentistas em São Paulo, SP',
    },
  });

  return { tenantId: t.id, buscaId: busca.id, jobId: job.id };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);

  const a = await montarTenant('a');
  const b = await montarTenant('b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  buscaA = a.buscaId;
  jobA = a.jobId;
}, TIMEOUT_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  await admin.$disconnect();
  await app.close();
}, TIMEOUT_MS);

describe('pre-condicao', () => {
  it('a API nao esta conectada como dono das tabelas', async () => {
    // Sem esta linha, tudo abaixo passaria de graca com o `DATABASE_URL_APP`
    // ausente: o `PrismaService` cairia no `DATABASE_URL`, a aplicacao voltaria
    // a ser dona superusuaria, e a politica sairia do caminho sem nada quebrar.
    const linhas = await prisma.$queryRaw<Array<{ usuario: string }>>`
      SELECT current_user AS usuario`;
    expect(linhas[0]?.usuario).toBe('propectai_app');
  });
});

describe('leitura sem contexto de tenant', () => {
  it('buscas e jobs devolvem zero — com denominador', async () => {
    // O denominador separa "a politica negou" de "nao ha nada". Sem ele, este
    // teste passaria contra banco vazio e nao estaria provando coisa alguma.
    const buscasReais = await admin.prospectingSearch.count({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    const jobsReais = await admin.scrapeJob.count({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    expect(buscasReais).toBe(2);
    expect(jobsReais).toBe(2);

    expect(await prisma.prospectingSearch.count()).toBe(0);
    expect(await prisma.scrapeJob.count()).toBe(0);
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca a busca do A, nem sabendo o id', async () => {
    // Consulta pelo `id` puro, sem `tenantId` em lugar nenhum — o que um
    // `where` mal escrito faria.
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.prospectingSearch.findMany({ where: { id: buscaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem o job', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.scrapeJob.findMany({ where: { id: jobA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga os dois', async () => {
    // O contraponto obrigatorio: um teste que so prova "nao ve" tambem passaria
    // com a tabela vazia ou com o id errado.
    const { buscas, jobs } = await prisma.comTenant(tenantA, async (tx) => ({
      buscas: await tx.prospectingSearch.findMany({ where: { id: buscaA } }),
      jobs: await tx.scrapeJob.findMany({ where: { id: jobA } }),
    }));
    expect(buscas).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });
});

describe('WITH CHECK', () => {
  it('criar busca com o tenantId do vizinho e recusado', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.prospectingSearch.create({
          data: { tenantId: tenantA, niche: 'Invasao', stateUf: 'SP', city: 'São Paulo' },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.prospectingSearch.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('mexer no job do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. A contagem zero distingue, e a leitura seguinte confirma que a
    // linha continua intacta.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.scrapeJob.updateMany({ where: { id: jobA }, data: { status: 'FAILED' } }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.scrapeJob.findUniqueOrThrow({ where: { id: jobA } });
    expect(depois.status).toBe('PENDING');
  });
});
