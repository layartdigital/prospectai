import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Isolamento da familia Comercial, provado pelo banco. **A ultima da fase B.**
 *
 * Tres tabelas: `proposals`, `proposal_items` e `contracts`.
 *
 * ---
 *
 * **Esta familia nao tinha teste nenhum.** Foi conferido: nenhum spec da API ou
 * do worker tocava `proposal`, `proposalItem` ou `contract`, e o `seed.ts`
 * tambem nao cria nenhum. Este arquivo nao esta cobrindo a politica em cima de
 * algo ja testado — ele e a primeira cobertura que a familia recebe.
 *
 * Isso muda como ler um verde aqui: a suite passar prova que a familia **isola**,
 * nao que o fluxo de propostas **funciona**. A segunda garantia nao existe.
 *
 * ---
 *
 * **Dois testes existem so aqui:**
 *
 * 1. "o filho se protege sozinho" — `proposal_items` ganhou `tenantId` nesta
 *    entrega, e a razao inteira de te-lo e nao depender de ser sempre lido
 *    atraves do pai.
 *
 * 2. "a FK composta e uma garantia separada" — ela vale com o RLS desligado, e
 *    o teste prova isso usando o papel que **ignora** a politica.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no `.env`.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;

let tenantA = '';
let tenantB = '';
let propostaA = '';
let itemA = '';
let contratoA = '';

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  propostaId: string;
  itemId: string;
  contratoId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Comercial ${rotulo} ${sufixo}`,
      slug: `comercial-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const proposta = await admin.proposal.create({
    data: {
      tenantId: t.id,
      title: `Proposta ${rotulo} ${sufixo}`,
      totalCents: 250_000,
      // **Sem `tenantId` aqui, de proposito.** Numa escrita aninhada o Prisma
      // preenche sozinho os escalares da relacao a partir do pai — os dois,
      // agora que a FK e composta —, e o tipo gerado nem os aceita. E
      // exatamente a forma do `proposals.service.ts:103`, que esta entrega nao
      // mudou: se a suposicao estiver errada, o typecheck acusa nos dois
      // lugares ao mesmo tempo, e nao so aqui.
      items: {
        create: [
          {
            description: `Servico ${rotulo}`,
            quantity: 1,
            unitCents: 250_000,
            sortOrder: 0,
          },
        ],
      },
    },
    include: { items: true },
  });

  const contrato = await admin.contract.create({
    data: { tenantId: t.id, proposalId: proposta.id, title: `Contrato ${rotulo}` },
  });

  return {
    tenantId: t.id,
    propostaId: proposta.id,
    itemId: proposta.items[0]!.id,
    contratoId: contrato.id,
  };
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
  propostaA = a.propostaId;
  itemA = a.itemId;
  contratoA = a.contratoId;
}, TIMEOUT_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
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
  it('as tres tabelas devolvem zero — com denominador', async () => {
    expect(
      await admin.proposal.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);
    expect(
      await admin.proposalItem.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);

    expect(await prisma.proposal.count()).toBe(0);
    expect(await prisma.proposalItem.count()).toBe(0);
    expect(await prisma.contract.count()).toBe(0);
  });
});

/**
 * **O filho se protege sozinho — e essa e a razao inteira da coluna nova.**
 *
 * Antes desta entrega, `proposal_items` nao tinha `tenantId`. A tabela e
 * alcancada exclusivamente aninhada em `proposal` — um `items: { create }` e
 * quatro `include` —, entao a politica de `proposals` ja a protegeria **de
 * fato**: consulta que nao acha o pai nunca chega no filho.
 *
 * Mas isso e propriedade do codigo de hoje. Um `$queryRaw`, ou um
 * `proposalItem.findMany({ where: { proposalId } })` escrito daqui a seis
 * meses, desfaz a garantia sem tocar em nada que pareca seguranca.
 *
 * O teste abaixo e exatamente essa consulta — pelo `proposalId` puro, sem
 * passar pelo pai. Se a coluna nao existisse, ela devolveria os itens da
 * proposta do vizinho.
 */
describe('o filho se protege sozinho', () => {
  it('lido direto pelo proposalId, do contexto errado, nao vem nada', async () => {
    // Denominador: o item existe e pende da proposta do A.
    expect(await admin.proposalItem.count({ where: { proposalId: propostaA } })).toBe(1);

    const vistos = await prisma.comTenant(tenantB, (tx) =>
      tx.proposalItem.findMany({ where: { proposalId: propostaA } }),
    );
    expect(vistos).toHaveLength(0);
  });

  it('e do contexto certo vem', async () => {
    const vistos = await prisma.comTenant(tenantA, (tx) =>
      tx.proposalItem.findMany({ where: { proposalId: propostaA } }),
    );
    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.id).toBe(itemA);
  });

  it('o include a partir da proposta continua funcionando', async () => {
    // A leitura que o produto de fato faz. Prova que a politica no filho nao
    // quebrou o caminho normal — as duas tabelas estao sob politica, e o
    // contexto vale para a consulta inteira.
    const proposta = await prisma.comTenant(tenantA, (tx) =>
      tx.proposal.findFirst({
        where: { id: propostaA },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      }),
    );
    expect(proposta?.items).toHaveLength(1);
    expect(proposta?.items[0]?.description).toBe('Servico a');
  });
});

/**
 * **A FK composta e uma garantia separada da politica.**
 *
 * A politica esconde a linha de quem esta no contexto errado. A FK faz com que
 * item ligado a proposta de outro tenant **deixe de ser representavel** — e
 * integridade referencial roda por fora do RLS, por desenho do Postgres.
 *
 * Por isso o teste abaixo usa o papel que **ignora** a politica: e o unico jeito
 * de provar que a recusa vem da FK e nao do RLS. Com o cliente da aplicacao, a
 * politica barraria antes e o teste passaria pelo motivo errado.
 */
describe('a FK composta e uma garantia separada', () => {
  it('ligar item ao pai de outro tenant e recusado mesmo ignorando a politica', async () => {
    await expect(
      admin.proposalItem.create({
        data: {
          tenantId: tenantB,
          proposalId: propostaA,
          description: 'Invasao',
          quantity: 1,
          unitCents: 1,
        },
      }),
    ).rejects.toThrow();

    expect(await admin.proposalItem.count({ where: { proposalId: propostaA } })).toBe(1);
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca a proposta do A, nem sabendo o id', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.proposal.findMany({ where: { id: propostaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem o contrato', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.contract.findMany({ where: { id: contratoA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e o contrato do contexto certo traz a proposta e o lead nulo', async () => {
    // `contract.proposal.lead.name` e lido em tres lugares do
    // `proposals.service.ts` — dois saltos de `include`, num arquivo que fala de
    // contratos. A familia 5 registrou esse caminho; aqui ele e exercitado.
    const contrato = await prisma.comTenant(tenantA, (tx) =>
      tx.contract.findFirst({
        where: { id: contratoA },
        include: { proposal: { include: { lead: true } } },
      }),
    );
    expect(contrato?.proposal?.id).toBe(propostaA);
    // A proposta deste cenario nao tem lead — o `?? null` do servico e o que
    // cobre isso, e vale ter a forma fixada.
    expect(contrato?.proposal?.lead).toBeNull();
  });
});

describe('WITH CHECK', () => {
  it('criar proposta com o tenantId do vizinho e recusado', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.proposal.create({ data: { tenantId: tenantA, title: 'Invasao' } }),
      ),
    ).rejects.toThrow();

    const total = await admin.proposal.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('assinar o contrato do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. Contagem zero distingue, e a leitura seguinte confirma.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.contract.updateMany({
        where: { id: contratoA },
        data: { status: 'SIGNED', signedAt: new Date() },
      }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.contract.findUniqueOrThrow({ where: { id: contratoA } });
    expect(depois.status).toBe('DRAFT');
    expect(depois.signedAt).toBeNull();
  });
});
