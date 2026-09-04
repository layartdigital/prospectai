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
 * Isolamento da familia Atividade do lead, provado pelo banco.
 *
 * Seis tabelas: `lead_activities`, `lead_contact_records`, `lead_follow_ups`,
 * `lead_notes`, `lead_digital_presences` e `outreach_messages`.
 *
 * Molde do `rls-coleta.spec.ts`, com **um teste a mais que nao existe nos
 * outros dois** — e que e a razao principal deste arquivo. Ver o bloco
 * "o `include` some em silencio", abaixo.
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
let notaA = '';
let mensagemA = '';

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  leadId: string;
  notaId: string;
  mensagemId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Atividade ${rotulo} ${sufixo}`,
      slug: `atividade-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const lead = await admin.lead.create({
    data: {
      tenantId: t.id,
      name: `Negocio ${rotulo} ${sufixo}`,
      fingerprint: createHash('sha256').update(`ativ-${rotulo}-${sufixo}`).digest('hex'),
    },
  });

  // Uma linha em cada uma das seis. O teste do `include` depende de as quatro
  // do detalhe do lead existirem de verdade — senao "veio vazio" seria a
  // resposta certa pelo motivo errado.
  const nota = await admin.leadNote.create({
    data: { tenantId: t.id, leadId: lead.id, content: `Nota ${rotulo}` },
  });

  await admin.leadActivity.create({
    data: { tenantId: t.id, leadId: lead.id, type: 'NOTE_ADDED' },
  });

  await admin.leadContactRecord.create({
    data: {
      tenantId: t.id,
      leadId: lead.id,
      channel: 'WHATSAPP',
      direction: 'SENT',
    },
  });

  await admin.leadFollowUp.create({
    data: { tenantId: t.id, leadId: lead.id, dueAt: new Date(Date.now() + 86_400_000) },
  });

  await admin.leadDigitalPresence.create({
    data: { tenantId: t.id, leadId: lead.id },
  });

  const mensagem = await admin.outreachMessage.create({
    data: {
      tenantId: t.id,
      leadId: lead.id,
      prompt: `prompt ${rotulo}`,
      content: `conteudo ${rotulo}`,
    },
  });

  return { tenantId: t.id, leadId: lead.id, notaId: nota.id, mensagemId: mensagem.id };
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
  notaA = a.notaId;
  mensagemA = a.mensagemId;
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
  it('as seis tabelas devolvem zero — com denominador', async () => {
    // O denominador separa "a politica negou" de "nao ha nada".
    const reais = await admin.leadNote.count({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    expect(reais).toBe(2);

    expect(await prisma.leadNote.count()).toBe(0);
    expect(await prisma.leadActivity.count()).toBe(0);
    expect(await prisma.leadContactRecord.count()).toBe(0);
    expect(await prisma.leadFollowUp.count()).toBe(0);
    expect(await prisma.leadDigitalPresence.count()).toBe(0);
    expect(await prisma.outreachMessage.count()).toBe(0);
  });
});

/**
 * **O `include` e o contexto — reescrito em 03/09, quando a familia 5 entrou.**
 *
 * Quatro destas seis tabelas nunca sao consultadas diretamente pela tela de
 * detalhe do lead: elas chegam por `include` a partir de `lead`.
 *
 * A versao original deste bloco registrava o modo de falha mais silencioso do
 * RLS, observavel enquanto `leads` ainda estava desprotegida: a consulta
 * encontrava o lead e devolvia as listas filhas vazias. **Nada falhava, nada
 * avisava**, e a tela abria mostrando um lead sem historico nenhum.
 *
 * A migration `20260903230000_rls_familia_leads` fechou essa janela, como
 * aquele comentario previa. O primeiro teste abaixo passou a medir o sintoma
 * novo — o lead some inteiro, e `null` na raiz quebra rapido.
 *
 * **O segundo teste e o que sobrou de valor da versao antiga, e agora sem
 * depender do estado de `leads`:** as filhas sao lidas direto, pelo `leadId`,
 * do contexto errado. Se elas dependessem de carona na mae, esta consulta
 * traria linha. Nao traz — cada uma responde por si. Esse enunciado nao volta a
 * vencer quando outra familia mudar.
 */
describe('o include e o contexto', () => {
  it('lido do contexto errado, o lead some inteiro', async () => {
    const lead = await prisma.comTenant(tenantB, (tx) =>
      tx.lead.findFirst({
        where: { id: leadA },
        include: {
          notes: true,
          activities: true,
          contactRecords: true,
          followUps: true,
          digitalPresence: true,
        },
      }),
    );

    // Ate 03/09 esta linha era `not.toBeNull()`, e as quatro listas vinham
    // vazias. O `leads` agora tem politica, e a falha ficou barulhenta.
    expect(lead).toBeNull();
  });

  it('as filhas nao dependem de carona na mae', async () => {
    // Sem passar pelo lead: cada tabela consultada direto pelo `leadId`, do
    // contexto do vizinho. Denominador primeiro, senao zero nao prova nada.
    expect(await admin.leadNote.count({ where: { leadId: leadA } })).toBe(1);

    const vistas = await prisma.comTenant(tenantB, async (tx) => ({
      notas: await tx.leadNote.count({ where: { leadId: leadA } }),
      atividades: await tx.leadActivity.count({ where: { leadId: leadA } }),
      contatos: await tx.leadContactRecord.count({ where: { leadId: leadA } }),
      followUps: await tx.leadFollowUp.count({ where: { leadId: leadA } }),
      presenca: await tx.leadDigitalPresence.count({ where: { leadId: leadA } }),
    }));

    expect(vistas).toEqual({
      notas: 0,
      atividades: 0,
      contatos: 0,
      followUps: 0,
      presenca: 0,
    });
  });

  it('do contexto certo, as quatro vem preenchidas', async () => {
    // O contraponto obrigatorio. Sem ele o teste acima passaria com o cenario
    // mal montado — e "vazio" seria a resposta certa pelo motivo errado.
    const lead = await prisma.comTenant(tenantA, (tx) =>
      tx.lead.findFirst({
        where: { id: leadA },
        include: {
          notes: true,
          activities: true,
          contactRecords: true,
          followUps: true,
          digitalPresence: true,
        },
      }),
    );

    expect(lead?.notes).toHaveLength(1);
    expect(lead?.activities).toHaveLength(1);
    expect(lead?.contactRecords).toHaveLength(1);
    expect(lead?.followUps).toHaveLength(1);
    expect(lead?.digitalPresence).not.toBeNull();
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca a nota do A, nem sabendo o id', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.leadNote.findMany({ where: { id: notaA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem a mensagem de abordagem', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.outreachMessage.findMany({ where: { id: mensagemA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga as duas', async () => {
    const { notas, mensagens } = await prisma.comTenant(tenantA, async (tx) => ({
      notas: await tx.leadNote.findMany({ where: { id: notaA } }),
      mensagens: await tx.outreachMessage.findMany({ where: { id: mensagemA } }),
    }));
    expect(notas).toHaveLength(1);
    expect(mensagens).toHaveLength(1);
  });
});

describe('WITH CHECK', () => {
  it('criar nota com o tenantId do vizinho e recusado', async () => {
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.leadNote.create({
          data: { tenantId: tenantA, leadId: leadA, content: 'Invasao' },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.leadNote.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('reescrever a nota do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. Contagem zero distingue, e a leitura seguinte confirma.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.leadNote.updateMany({ where: { id: notaA }, data: { content: 'Alterada' } }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.leadNote.findUniqueOrThrow({ where: { id: notaA } });
    expect(depois.content).toBe('Nota a');
  });
});
