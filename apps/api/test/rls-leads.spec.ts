import { createHash } from 'node:crypto';
import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Isolamento da familia Leads nucleo, provado pelo banco.
 *
 * Sete tabelas: `leads`, `lead_source_records`, `lead_scores`,
 * `lead_score_reasons`, `suppression_entries`, `tags` e `lead_tags`.
 *
 * ---
 *
 * **Este arquivo e a unica cobertura que tres destas tabelas tem.**
 *
 * `suppression_entries`, `tags` e `lead_tags` nao sao tocadas por nenhum
 * servico, nenhum outro teste e nem pelo `seed.ts` — a varredura de 03/09 nao
 * achou um unico chamador. A politica entrou nelas assim mesmo, para que o
 * primeiro chamador ja nasca contra tabela protegida. O cenario abaixo cria uma
 * linha em cada uma **justamente porque nada mais cria**: sem isso, ligar a
 * politica nas tres seria protecao que ninguem nunca exerceu.
 *
 * ---
 *
 * **O teste que so existe aqui** e o bloco "o `include` para de mentir". Ver o
 * comentario longo antes dele: ele e o contraponto direto do teste homonimo do
 * `rls-atividade.spec.ts`, e mede a mudanca de sintoma que esta migration
 * provoca.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no `.env`.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;

let tenantA = '';
let tenantB = '';
let leadA = '';
let scoreA = '';
let tagA = '';
let propostaA = '';

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  leadId: string;
  scoreId: string;
  tagId: string;
  propostaId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Leads ${rotulo} ${sufixo}`,
      slug: `leads-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const lead = await admin.lead.create({
    data: {
      tenantId: t.id,
      name: `Negocio ${rotulo} ${sufixo}`,
      fingerprint: createHash('sha256').update(`leads-${rotulo}-${sufixo}`).digest('hex'),
      addressCity: 'São Paulo',
      websiteStatus: 'SEM_SITE',
    },
  });

  await admin.leadSourceRecord.create({
    data: { tenantId: t.id, leadId: lead.id, payload: { origem: rotulo } },
  });

  const score = await admin.leadScore.create({
    data: { tenantId: t.id, leadId: lead.id, value: 70, level: 'ALTA' },
  });

  await admin.leadScoreReason.create({
    data: {
      tenantId: t.id,
      scoreId: score.id,
      code: 'SEM_SITE',
      label: 'Sem site proprio',
      weight: 30,
      polarity: 'POSITIVE',
    },
  });

  // As tres sem chamador. Existem no cenario porque nada mais no repositorio
  // as cria, e tabela protegida que nunca recebe linha nao prova nada.
  await admin.suppressionEntry.create({
    data: { tenantId: t.id, email: `bloqueado-${rotulo}-${sufixo}@exemplo.local` },
  });

  const tag = await admin.tag.create({
    data: { tenantId: t.id, name: `Prioridade ${rotulo} ${sufixo}` },
  });

  await admin.leadTag.create({
    data: { tenantId: t.id, leadId: lead.id, tagId: tag.id },
  });

  // A proposta e o veiculo do teste do `include`: ela aponta para o lead e
  // `proposals` ainda nao tem politica — e da familia 8.
  const proposta = await admin.proposal.create({
    data: { tenantId: t.id, leadId: lead.id, title: `Proposta ${rotulo}` },
  });

  return {
    tenantId: t.id,
    leadId: lead.id,
    scoreId: score.id,
    tagId: tag.id,
    propostaId: proposta.id,
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
  leadA = a.leadId;
  scoreA = a.scoreId;
  tagA = a.tagId;
  propostaA = a.propostaId;
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
  it('as sete tabelas devolvem zero — com denominador', async () => {
    // O denominador separa "a politica negou" de "nao ha nada". Sao duas
    // linhas em cada tabela: uma por tenant.
    expect(await admin.lead.count({ where: { tenantId: { in: [tenantA, tenantB] } } })).toBe(2);
    expect(await admin.tag.count({ where: { tenantId: { in: [tenantA, tenantB] } } })).toBe(2);
    expect(
      await admin.suppressionEntry.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);

    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.leadSourceRecord.count()).toBe(0);
    expect(await prisma.leadScore.count()).toBe(0);
    expect(await prisma.leadScoreReason.count()).toBe(0);
    expect(await prisma.suppressionEntry.count()).toBe(0);
    expect(await prisma.tag.count()).toBe(0);
    expect(await prisma.leadTag.count()).toBe(0);
  });
});

/**
 * **O `include` nao mente mais — reescrito em 04/09, ao fechar a fase B.**
 *
 * Este bloco vinha medindo o modo de falha do `include`, e ele mudou de forma
 * tres vezes conforme as familias entraram. Vale registrar a progressao, porque
 * cada degrau e um sintoma diferente e o primeiro era o pior:
 *
 *   1. **Familia 4** (`rls-atividade.spec.ts`): o lead era encontrado e as
 *      listas filhas vinham vazias. Nada falhava, nada avisava, e a tela abria
 *      mostrando um lead sem historico nenhum.
 *   2. **Familia 5** (aqui): o lead sumia, mas a proposta que o continha ainda
 *      aparecia — `proposals` nao tinha politica. O `include` devolvia uma
 *      proposta com `lead: null`.
 *   3. **Familia 8**: a proposta some tambem. **Nao sobra nenhuma janela em que
 *      um `include` devolva estrutura parcial**, porque nao sobra tabela
 *      escopada sem politica.
 *
 * A versao anterior deste bloco afirmava `expect(proposta).not.toBeNull()`, e o
 * comentario dela previa por escrito que a familia 8 desfaria isso. A previsao
 * estava certa e nao virou tarefa: o teste quebrou quando a familia 8 entrou.
 * **A licao ficou registrada aqui e nao numa migration:** "este teste some
 * quando a familia N entrar" e uma tarefa com data, e comentario de migration e
 * onde ela nao vai ser vista.
 *
 * O que continua importando na pratica: `proposals.service.ts` le
 * `contract.proposal.lead.name` em tres lugares — dois saltos de `include`, num
 * arquivo que fala de contratos. Hoje um contexto errado corta esse caminho na
 * raiz, e alto.
 */
describe('o include nao mente mais', () => {
  it('do contexto errado, a proposta some — e com ela a cadeia inteira', async () => {
    const proposta = await prisma.comTenant(tenantB, (tx) =>
      tx.proposal.findFirst({ where: { id: propostaA }, include: { lead: true } }),
    );

    // Denominador: a proposta existe, e e do tenant A.
    expect(await admin.proposal.count({ where: { id: propostaA } })).toBe(1);

    // Nao ha mais estrutura parcial: nem proposta, nem lead nulo dentro dela.
    expect(proposta).toBeNull();
  });

  it('do contexto certo, a proposta traz o lead', async () => {
    // O contraponto obrigatorio: sem ele, "nulo" seria a resposta certa pelo
    // motivo errado — proposta sem lead, cenario mal montado.
    const proposta = await prisma.comTenant(tenantA, (tx) =>
      tx.proposal.findFirst({ where: { id: propostaA }, include: { lead: true } }),
    );

    expect(proposta?.lead?.id).toBe(leadA);
  });

  it('o lead visto do contexto certo traz score, razoes, origem e tag', async () => {
    // Prova a cadeia inteira de uma vez: `leads` -> `lead_scores` ->
    // `lead_score_reasons`, mais `lead_source_records` e `lead_tags`. Todas as
    // cinco estao sob politica, e o `include` so devolve conteudo porque o
    // contexto vale para a consulta toda, e nao apenas para a tabela raiz.
    const lead = await prisma.comTenant(tenantA, (tx) =>
      tx.lead.findFirst({
        where: { id: leadA },
        include: {
          score: { include: { reasons: true } },
          sourceRecord: true,
          tags: true,
        },
      }),
    );

    expect(lead?.score?.value).toBe(70);
    expect(lead?.score?.reasons).toHaveLength(1);
    expect(lead?.sourceRecord).not.toBeNull();
    expect(lead?.tags).toHaveLength(1);
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca o lead do A, nem sabendo o id', async () => {
    // Consulta pelo `id` puro, sem `tenantId` em lugar nenhum — o que um
    // `where` mal escrito faria. E o caso do id vazado por log ou URL.
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.lead.findMany({ where: { id: leadA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem o score', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.leadScore.findMany({ where: { id: scoreA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem a tag — a unica cobertura que esta tabela tem', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.tag.findMany({ where: { id: tagA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga os tres', async () => {
    const { leads, scores, tags } = await prisma.comTenant(tenantA, async (tx) => ({
      leads: await tx.lead.findMany({ where: { id: leadA } }),
      scores: await tx.leadScore.findMany({ where: { id: scoreA } }),
      tags: await tx.tag.findMany({ where: { id: tagA } }),
    }));
    expect(leads).toHaveLength(1);
    expect(scores).toHaveLength(1);
    expect(tags).toHaveLength(1);
  });
});

describe('WITH CHECK', () => {
  it('criar lead com o tenantId do vizinho e recusado', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.lead.create({
          data: {
            tenantId: tenantA,
            name: 'Invasao',
            fingerprint: createHash('sha256').update(`invasao-${sufixo}`).digest('hex'),
          },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.lead.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('renomear o lead do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. Contagem zero distingue, e a leitura seguinte confirma.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.lead.updateMany({ where: { id: leadA }, data: { name: 'Renomeado' } }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.lead.findUniqueOrThrow({ where: { id: leadA } });
    expect(depois.name).toBe(`Negocio a ${sufixo}`);
  });

  it('apagar o lead do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // A exclusao merece linha propria: e a operacao em que "nao encontrou" e
    // "nao pode" sao mais faceis de confundir, e a unica cujo erro nao tem
    // volta.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.lead.deleteMany({ where: { id: leadA } }),
    );
    expect(r.count).toBe(0);

    expect(await admin.lead.count({ where: { id: leadA } })).toBe(1);
  });
});
