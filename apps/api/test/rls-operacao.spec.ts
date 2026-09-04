import { createHash, randomBytes } from 'node:crypto';
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
 * Isolamento da familia Operacao e registro, provado pelo banco.
 *
 * Seis tabelas: `audit_logs`, `notifications`, `invitations`, `export_jobs`,
 * `app_settings` e `feature_flags`.
 *
 * ---
 *
 * **Tres tabelas so tem cobertura aqui.** `export_jobs` e `feature_flags` nao
 * sao tocadas por nada no produto; `app_settings` so pelo `seed.ts`. O cenario
 * cria uma linha em cada uma porque nada mais cria — sem isso, ligar a politica
 * nas tres seria protecao que ninguem nunca exerceu.
 *
 * **Dois testes existem so aqui:**
 *
 * 1. "a linha orfa nao volta em contexto nenhum" — `audit_logs.tenantId` e
 *    anulavel, e e a unica tabela do programa assim. Ver o bloco.
 *
 * 2. "o convite e lido pelo token, antes de haver sessao" — mesma forma do
 *    guard na familia 6: um caminho legitimo que precisa atravessar.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no `.env`.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);

let app: INestApplication;
let prisma: PrismaService;
let sistema: PrismaSistemaService;

let tenantA = '';
let tenantB = '';
let notificacaoA = '';
let registroA = '';
let registroOrfao = '';
let conviteA = '';
const tokenHashA = createHash('sha256').update(`convite-${sufixo}`).digest('hex');

const TIMEOUT_MS = 60_000;

async function montarTenant(rotulo: string): Promise<{
  tenantId: string;
  notificacaoId: string;
  registroId: string;
  conviteId: string;
}> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Operacao ${rotulo} ${sufixo}`,
      slug: `operacao-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });

  const notificacao = await admin.notification.create({
    data: { tenantId: t.id, type: 'SEARCH_COMPLETED', title: `Busca ${rotulo}` },
  });

  const registro = await admin.auditLog.create({
    data: {
      tenantId: t.id,
      action: 'teste.familia_operacao',
      entityType: 'Tenant',
      entityId: t.id,
    },
  });

  const convite = await admin.invitation.create({
    data: {
      tenantId: t.id,
      email: `convidado-${rotulo}-${sufixo}@teste.propectai.local`,
      // Hash unico global: a coluna e `@unique` sem `tenantId`.
      tokenHash:
        rotulo === 'a'
          ? tokenHashA
          : createHash('sha256').update(`convite-${rotulo}-${sufixo}`).digest('hex'),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });

  // As tres sem chamador de produto. Existem no cenario porque nada mais as
  // cria, e tabela protegida que nunca recebe linha nao prova nada.
  await admin.exportJob.create({ data: { tenantId: t.id } });

  await admin.appSetting.create({
    data: { tenantId: t.id, key: `teste.${sufixo}`, value: { rotulo } },
  });

  await admin.featureFlag.create({
    data: { tenantId: t.id, key: `teste.${sufixo}`, enabled: true },
  });

  return {
    tenantId: t.id,
    notificacaoId: notificacao.id,
    registroId: registro.id,
    conviteId: convite.id,
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
  notificacaoA = a.notificacaoId;
  registroA = a.registroId;
  conviteA = a.conviteId;

  /**
   * A linha orfa: registro de auditoria com `tenantId` nulo.
   *
   * E o estado em que a `SetNull` do `Tenant` deixa o log quando um workspace e
   * apagado. Montado a mao em vez de apagar um tenant de verdade — apagar
   * levaria junto tudo o que este arquivo esta testando, e o que interessa e o
   * estado final da linha, nao o caminho ate ele.
   */
  const orfao = await admin.auditLog.create({
    data: {
      tenantId: null,
      action: 'teste.orfao',
      entityType: 'Tenant',
      entityId: `apagado-${sufixo}`,
    },
  });
  registroOrfao = orfao.id;
}, TIMEOUT_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  // `audit_logs` nao cai por cascade — a relacao e `SetNull`, e e justamente
  // esse o ponto do arquivo. Limpeza explicita, incluindo a orfa.
  await admin.auditLog
    .deleteMany({ where: { entityId: { contains: sufixo } } })
    .catch(() => {});
  await admin.auditLog.deleteMany({ where: { id: registroOrfao } }).catch(() => {});
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
    expect(
      await admin.notification.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);
    expect(
      await admin.featureFlag.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    ).toBe(2);

    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.invitation.count()).toBe(0);
    expect(await prisma.exportJob.count()).toBe(0);
    expect(await prisma.appSetting.count()).toBe(0);
    expect(await prisma.featureFlag.count()).toBe(0);
  });
});

/**
 * **A linha orfa nao volta em contexto nenhum — e so `audit_logs` tem isso.**
 *
 * `audit_logs.tenantId` e `String?`, e a relacao com `Tenant` e `SetNull`:
 * apagar um workspace nao apaga o log dele, anula o vinculo. E a unica tabela
 * do programa inteiro com a coluna anulavel.
 *
 * Sob a politica, `NULL = <qualquer coisa>` e `NULL`, e `NULL` nao e `TRUE`. A
 * linha fica invisivel ao papel da aplicacao **em todo contexto**, e nao apenas
 * no contexto errado. Nao existe valor de `app.tenant_id` que a traga de volta.
 *
 * Isso e o comportamento certo — ninguem deveria ver o log de um workspace que
 * nao existe mais — e hoje e inofensivo por um motivo concreto: **a aplicacao
 * nunca le `audit_logs`.** Sao 24 `create`, um `updateMany` pelo papel do
 * sistema, e zero leituras em `apps/api/src` e `apps/worker/src`.
 *
 * O teste fixa o comportamento agora, para o dia em que alguem escrever o
 * painel de auditoria e precisar saber disso antes, e nao depois.
 */
describe('a linha orfa de auditoria', () => {
  it('existe de verdade — denominador', async () => {
    const orfa = await admin.auditLog.findUniqueOrThrow({ where: { id: registroOrfao } });
    expect(orfa.tenantId).toBeNull();
  });

  it('nao aparece nem no contexto do A, nem no do B, nem sem contexto', async () => {
    // Os tres contextos possiveis do papel da aplicacao. Nenhum a alcanca —
    // e o ponto e que **nao existe um quarto** que alcancasse.
    const semContexto = await prisma.auditLog.count({ where: { id: registroOrfao } });
    const noA = await prisma.comTenant(tenantA, (tx) =>
      tx.auditLog.count({ where: { id: registroOrfao } }),
    );
    const noB = await prisma.comTenant(tenantB, (tx) =>
      tx.auditLog.count({ where: { id: registroOrfao } }),
    );

    expect({ semContexto, noA, noB }).toEqual({ semContexto: 0, noA: 0, noB: 0 });
  });

  it('e o papel do sistema alcanca — que e como a eliminacao do ator funciona', async () => {
    // O `PrivacyService.anonimizarAtor` varre `audit_logs` inteiro pelo
    // `actorId`, sem tenant nenhum, porque o pedido de eliminacao e da pessoa e
    // uma pessoa pode ser membro de varios workspaces. Se ele rodasse pelo papel
    // comum, devolveria `linhas: 0` sem erro — indistinguivel de "essa pessoa
    // nao fez nada".
    const vistas = await sistema.atravessandoTenants(
      'teste: a eliminacao do ator varre todos os workspaces, e as linhas orfas',
      (db) => db.auditLog.count({ where: { id: registroOrfao } }),
    );
    expect(vistas).toBe(1);
  });

  it('gravar auditoria sem tenant e recusado pelo WITH CHECK', async () => {
    // O outro lado da moeda: a politica nao deixa a aplicacao *criar* linha
    // orfa. Os 24 `create` do produto passam `tenantId` sempre — auditoria sem
    // dono seria auditoria que ninguem consegue consultar.
    await expect(
      prisma.comTenant(tenantA, (tx) =>
        tx.auditLog.create({
          data: { tenantId: null, action: 'teste.sem_dono', entityType: 'Tenant' },
        }),
      ),
    ).rejects.toThrow();
  });
});

/**
 * **O convite e lido pelo token, antes de haver sessao.**
 *
 * `team.service.ts:495` busca `invitations` pelo `tokenHash` usando o papel que
 * atravessa tenants. Mesma forma do guard na familia 6: nao ha contexto porque
 * quem clicou no link do convite ainda nao esta dentro de workspace nenhum.
 *
 * A autorizacao ali e o proprio token, que e o segredo — a politica nunca teve
 * papel nessa decisao. O teste fixa as duas metades, porque fixar so a primeira
 * deixaria passar o dia em que esse caminho fosse trocado por engano para o
 * cliente comum: o convite pararia de abrir, sem erro no servidor.
 */
describe('o convite e lido pelo token', () => {
  it('sem contexto, o papel da aplicacao nao acha o convite', async () => {
    const achado = await prisma.invitation.findUnique({ where: { tokenHash: tokenHashA } });
    expect(achado).toBeNull();
  });

  it('e o papel do sistema acha — que e como o link do convite abre', async () => {
    const achado = await sistema.atravessandoTenants(
      'teste: o convite e aberto por quem ainda nao esta em workspace nenhum',
      (db) => db.invitation.findUnique({ where: { tokenHash: tokenHashA } }),
    );
    expect(achado?.id).toBe(conviteA);
    expect(achado?.tenantId).toBe(tenantA);
  });
});

describe('leitura cruzada', () => {
  it('o tenant B nao alcanca a notificacao do A, nem sabendo o id', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.notification.findMany({ where: { id: notificacaoA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem o registro de auditoria', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.auditLog.findMany({ where: { id: registroA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem a configuracao — a unica cobertura que app_settings tem', async () => {
    const linhas = await prisma.comTenant(tenantB, (tx) =>
      tx.appSetting.findMany({ where: { tenantId: tenantA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('e com o contexto certo enxerga as tres', async () => {
    const { notificacoes, registros, configuracoes } = await prisma.comTenant(
      tenantA,
      async (tx) => ({
        notificacoes: await tx.notification.findMany({ where: { id: notificacaoA } }),
        registros: await tx.auditLog.findMany({ where: { id: registroA } }),
        configuracoes: await tx.appSetting.findMany({ where: { tenantId: tenantA } }),
      }),
    );
    expect(notificacoes).toHaveLength(1);
    expect(registros).toHaveLength(1);
    expect(configuracoes).toHaveLength(1);
  });
});

describe('WITH CHECK', () => {
  it('criar convite com o tenantId do vizinho e recusado', async () => {
    // Convite forjado e acesso ao workspace inteiro — o mesmo peso do
    // `membership` da familia 6.
    await expect(
      prisma.comTenant(tenantB, (tx) =>
        tx.invitation.create({
          data: {
            tenantId: tenantA,
            email: `invasao-${sufixo}@teste.propectai.local`,
            tokenHash: randomBytes(32).toString('hex'),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ),
    ).rejects.toThrow();

    const total = await admin.invitation.count({ where: { tenantId: tenantA } });
    expect(total).toBe(1);
  });

  it('marcar como lida a notificacao do A de dentro do B nao afeta linha nenhuma', async () => {
    // `updateMany` em vez de `update`: o segundo lancaria por nao encontrar a
    // linha, e "lancou" nao distingue **a politica escondeu** de **o id esta
    // errado**. Contagem zero distingue, e a leitura seguinte confirma.
    const r = await prisma.comTenant(tenantB, (tx) =>
      tx.notification.updateMany({
        where: { id: notificacaoA },
        data: { readAt: new Date() },
      }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.notification.findUniqueOrThrow({
      where: { id: notificacaoA },
    });
    expect(depois.readAt).toBeNull();
  });
});
