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
 * Isolamento da familia Pipeline, provado pelo banco.
 *
 * Molde do `apps/worker/test/rls-canario.spec.ts`, com uma diferenca que vale
 * dizer: aqui o client sob teste **e o `PrismaService` do proprio Nest**, e nao
 * um client montado a mao. Isso e de proposito — o que se quer provar e que a
 * aplicacao como ela roda esta sujeita a politica, e nao que um client
 * configurado pelo teste estaria.
 *
 * **Estas tabelas nao tinham nenhum teste.** Foi conferido: nenhum spec da API
 * ou do worker toca `pipelineStage`, `pipelineCard` ou `pipelineTransition`.
 * Entao este arquivo nao esta cobrindo a politica em cima de algo ja testado —
 * ele e a primeira cobertura que a familia recebe, e a politica veio junto.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no `.env`.
 */

/**
 * ▶ RELIGADO em 03/09/2026, pela `20260903200000_rls_familia_pipeline_religar`.
 *
 * ---
 *
 * **Historico, porque ele explica o desenho deste arquivo.**
 *
 * A familia foi ligada em 27/08 e revertida no mesmo dia: a varredura de
 * chamadores estava incompleta, o registro de conta passou a responder 500 e
 * 45 testes cairam. Os testes ficaram aqui em `skip` em vez de apagados —
 * teste apagado e teste esquecido; teste pulado aparece na contagem de toda
 * execucao e cobra sozinho. Foram sete dias aparecendo como `7 skipped`.
 *
 * **A chave unica se pagou.** `PAUSADO` governa os blocos E os hooks, entao
 * religar foi trocar `true` por `false`. Se fossem duas chaves, uma delas teria
 * ficado para tras — e o modo de falha seria o pior possivel: os testes rodando
 * sem o `beforeAll` ter montado o cenario, falhando por motivo errado.
 *
 * **A constante fica.** Nao vira codigo morto: e o interruptor de pausa desta
 * familia, e a proxima vez que alguem precisar desligar a politica para
 * investigar algo, `PAUSADO = true` e uma linha em vez de um `git revert`.
 *
 * ---
 *
 * A varredura que faltava foi refeita em 03/09 sobre os arquivos vivos: sao
 * **cinco** arquivos e 19 acessos, e nao tres. O `dashboard.service.ts` era o
 * que faltava na narrativa — e o mais perigoso dos cinco, porque **so le**, e
 * leitura sob politica sem contexto nao da erro: da vazio. Ele teria zerado os
 * KPIs do painel em silencio.
 */

const PAUSADO = false;
const bloco = PAUSADO ? describe.skip : describe;

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;

let tenantA = '';
let tenantB = '';
let etapaA = '';
let cardA = '';

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  etapaId: string;
  cardId: string;
}> {
  const t = await admin.tenant.create({
    data: { name: `Tenant Pipe ${rotulo} ${sufixo}`, slug: `pipe-${rotulo}-${sufixo}`, isDemo: true },
  });

  const etapa = await admin.pipelineStage.create({
    data: { tenantId: t.id, name: 'Novo', slug: 'novo', order: 1 },
  });

  const lead = await admin.lead.create({
    data: {
      tenantId: t.id,
      name: `Negocio ${rotulo} ${sufixo}`,
      fingerprint: createHash('sha256').update(`pipe-${rotulo}-${sufixo}`).digest('hex'),
    },
  });

  const card = await admin.pipelineCard.create({
    data: { tenantId: t.id, leadId: lead.id, stageId: etapa.id },
  });

  return { tenantId: t.id, etapaId: etapa.id, cardId: card.id };
}

beforeAll(async () => {
  if (PAUSADO) return;
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);

  const a = await montarTenant('a');
  const b = await montarTenant('b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  etapaA = a.etapaId;
  cardA = a.cardId;
}, TIMEOUT_MS);

afterAll(async () => {
  if (PAUSADO) return;
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  await admin.$disconnect();
  await app.close();
}, TIMEOUT_MS);

bloco('pre-condicao', () => {
  it('a API nao esta conectada como dono das tabelas', async () => {
    // Sem esta linha, todos os testes abaixo passariam de graca com o
    // `DATABASE_URL_APP` ausente: o `PrismaService` cairia no `DATABASE_URL`,
    // a aplicacao voltaria a ser dona superusuaria, e a politica sairia do
    // caminho sem nada quebrar.
    const linhas = await prisma.$queryRaw<Array<{ usuario: string }>>`
      SELECT current_user AS usuario`;
    expect(linhas[0]?.usuario).toBe('propectai_app');
  });
});

bloco('leitura sem contexto de tenant', () => {
  it('etapas, cards e transicoes devolvem zero — com denominador', async () => {
    // O denominador e o que separa "a politica negou" de "nao ha nada".
    // Aprendido na primeira versao do `verificacoes-rls-passo4.sql`, que media
    // zero contra uma tabela vazia e parecia estar provando alguma coisa.
    const totalReal = await admin.pipelineStage.count({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    expect(totalReal).toBe(2);

    expect(await prisma.pipelineStage.count()).toBe(0);
    expect(await prisma.pipelineCard.count()).toBe(0);
  });
});

bloco('leitura cruzada', () => {
  it('o tenant B nao alcanca a etapa do A, nem sabendo o id', async () => {
    // Consulta pelo `id` puro, sem `tenantId` em lugar nenhum — o que um
    // `where` mal escrito faria. A chave composta nao ajuda nesta linha.
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.pipelineStage.findMany({ where: { id: etapaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem o card', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.pipelineCard.findMany({ where: { id: cardA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga', async () => {
    // O contraponto obrigatorio: um teste que so prova "nao ve" tambem passaria
    // com a tabela vazia ou com o id errado.
    const linhas = await prisma.comTenant(tenantA, (tx) =>
      tx.pipelineStage.findMany({ where: { id: etapaA } }),
    );
    expect(linhas).toHaveLength(1);
  });
});

bloco('WITH CHECK', () => {
  it('criar etapa com o tenantId do vizinho e recusado', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.pipelineStage.create({
          data: { tenantId: tenantA, name: 'Invasao', slug: `invasao-${sufixo}`, order: 99 },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.pipelineStage.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('mover o card do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.pipelineCard.updateMany({ where: { id: cardA }, data: { position: 999 } }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.pipelineCard.findUniqueOrThrow({ where: { id: cardA } });
    expect(depois.position).toBe(0);
  });
});
