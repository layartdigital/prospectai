import { createHash } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { comTenant } from '../src/db/com-tenant';
import { criarPrismaApp } from '../src/db/prisma-app';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * S8 e S9 — o isolamento provado **pelo banco**.
 *
 * Passo 5 do `PLANO-RLS-v1.md`, e o passo que decide se o 4 vale alguma coisa.
 * O plano e explicito: *"so depois deles o RLS pode ser considerado ligado. Os
 * tres modos de falha do spike sao silenciosos; sem um teste que prove
 * isolamento, RLS e pior que uma extensao do Prisma, porque **parece** mais
 * seguro."*
 *
 * A diferenca em relacao ao S13 do `audit-pipeline.spec.ts` e o que se remove:
 * la o codigo sob teste sempre passa `tenantId` na clausula composta, entao o
 * que se prova e a chave. Aqui as consultas sao escritas **sem filtro de
 * tenant nenhum** — quem tem de recusar e a politica, ou nao ha politica.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `DATABASE_URL_APP` no
 * `.env`. Sem a variavel, o `criarPrismaApp` avisa alto e estes testes viram
 * teatro: por isso o primeiro deles confere que o papel realmente mudou.
 */

const admin = criarPrismaAdmin();
const app = criarPrismaApp();
const sufixo = Date.now().toString(36);
const TIMEOUT_HOOK_MS = 60_000;

let tenantA = '';
let tenantB = '';
let auditA = '';

async function montar(rotulo: string): Promise<{ tenantId: string; leadId: string }> {
  const t = await admin.tenant.create({
    data: { name: `Tenant RLS ${rotulo} ${sufixo}`, slug: `rls-${rotulo}-${sufixo}`, isDemo: true },
  });
  const lead = await admin.lead.create({
    data: {
      tenantId: t.id,
      name: `Negocio ${rotulo} ${sufixo}`,
      website: 'https://exemplo-rls.com.br',
      fingerprint: createHash('sha256').update(`rls-${rotulo}-${sufixo}`).digest('hex'),
    },
  });
  return { tenantId: t.id, leadId: lead.id };
}

beforeAll(async () => {
  await Promise.all([admin.$connect(), app.$connect()]);

  const a = await montar('a');
  const b = await montar('b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;

  // Fixture pelo papel `BYPASSRLS`. Se ela fosse montada pelo papel da
  // aplicacao, o proprio `WITH CHECK` a recusaria — e essa e a razao de o
  // passo 2 ter vindo antes deste.
  const audit = await admin.digitalPresenceAudit.create({
    data: { tenantId: tenantA, leadId: a.leadId, auditVersion: 'audit-v1', status: 'COMPLETED' },
  });
  auditA = audit.id;

  await admin.digitalPresenceCheck.create({
    data: { tenantId: tenantA, auditId: auditA, check: 'DNS', outcome: 'OK' },
  });
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  if (tenantA) await admin.tenant.delete({ where: { id: tenantA } }).catch(() => {});
  if (tenantB) await admin.tenant.delete({ where: { id: tenantB } }).catch(() => {});
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
}, TIMEOUT_HOOK_MS);

describe('pre-condicao', () => {
  it('a aplicacao NAO esta conectada como dono das tabelas', async () => {
    /**
     * **Sem este teste, todos os outros deste arquivo passariam de graca.**
     *
     * Se o `DATABASE_URL_APP` faltar, o `criarPrismaApp` cai no `DATABASE_URL`,
     * a aplicacao volta a ser dona, o `FORCE` sai do caminho — e um teste de
     * isolamento verde nao significaria nada. O aviso no console existe, mas
     * aviso em suite de 300 testes ninguem le.
     */
    const linhas = await app.$queryRaw<Array<{ usuario: string }>>`
      SELECT current_user AS usuario`;
    expect(linhas[0]?.usuario).toBe('propectai_app');
  });

  it('o papel de fixtures ignora a politica, e e isso que o mantem util', async () => {
    // `BYPASSRLS` sem contexto de tenant nenhum: enxerga a linha.
    const vista = await admin.digitalPresenceAudit.findUnique({ where: { id: auditA } });
    expect(vista).not.toBeNull();
  });
});

describe('S8 — leitura sem contexto nao enxerga nada', () => {
  it('auditoria: consulta sem filtro de tenant devolve zero', async () => {
    // Sem `comTenant`, `current_setting` devolve NULL, a comparacao e NULL, e
    // NULL nao e verdadeiro. **Negar por ausencia** e o comportamento certo:
    // um caminho que esqueceu de embrulhar falha barulhento, nao silencioso.
    const linhas = await app.digitalPresenceAudit.findMany({ where: { id: auditA } });
    expect(linhas).toHaveLength(0);
  });

  it('checagem: idem', async () => {
    const linhas = await app.digitalPresenceCheck.findMany({ where: { auditId: auditA } });
    expect(linhas).toHaveLength(0);
  });

  it('e a mesma consulta com o contexto certo enxerga', async () => {
    // O contraponto obrigatorio: um teste que so prova "nao ve" tambem passaria
    // com a tabela vazia, com o id errado, ou com o banco fora do ar.
    const linhas = await comTenant(app, tenantA, (tx) =>
      tx.digitalPresenceAudit.findMany({ where: { id: auditA } }),
    );
    expect(linhas).toHaveLength(1);
  });
});

describe('S9 — leitura cruzada devolve zero', () => {
  it('o tenant B nao alcanca a auditoria do A, nem sabendo o id', async () => {
    /**
     * **Aqui esta a diferenca em relacao ao S13.** A consulta busca pelo `id`
     * puro, sem `tenantId` em lugar nenhum — exatamente o que um `$queryRaw`
     * descuidado ou um `where` mal escrito fariam. A chave composta nao ajuda
     * nesta linha; quem recusa e a politica.
     */
    const linhas = await comTenant(app, tenantB, (tx) =>
      tx.digitalPresenceAudit.findMany({ where: { id: auditA } }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('nem por contagem, que e como um vazamento costuma comecar', async () => {
    const total = await comTenant(app, tenantB, (tx) => tx.digitalPresenceAudit.count());
    expect(total).toBe(0);
  });

  it('as checagens do A tambem somem para o B', async () => {
    const linhas = await comTenant(app, tenantB, (tx) => tx.digitalPresenceCheck.findMany());
    expect(linhas).toHaveLength(0);
  });
});

describe('WITH CHECK — nao da para gravar no vizinho', () => {
  it('gravar com o tenantId do A, de dentro do contexto do B, e recusado', async () => {
    /**
     * `USING` decide o que se ve; `WITH CHECK` decide o que se grava. Sem a
     * segunda clausula, este INSERT passaria: a linha nasceria com o
     * `tenantId` do vizinho, invisivel para quem escreveu e bem visivel para
     * ele.
     *
     * A FK composta resolve normalmente — integridade referencial ignora RLS
     * por desenho do Postgres —, entao quem tem de recusar aqui e a politica,
     * sozinha.
     */
    const leadDoA = await admin.lead.findFirstOrThrow({
      where: { tenantId: tenantA },
      select: { id: true },
    });

    await expect(
      comTenant(app, tenantB, (tx) =>
        tx.digitalPresenceAudit.create({
          data: {
            tenantId: tenantA,
            leadId: leadDoA.id,
            auditVersion: 'audit-v1',
            status: 'REQUESTED',
          },
        }),
      ),
    ).rejects.toThrow();

    // E nada ficou para tras.
    const total = await admin.digitalPresenceAudit.count({
      where: { tenantId: tenantA, status: 'REQUESTED' },
    });
    expect(total).toBe(0);
  });

  it('atualizar a auditoria do A de dentro do contexto do B nao afeta linha nenhuma', async () => {
    // `updateMany` nao estoura quando o `where` nao casa: devolve zero. E o
    // zero e a prova — sob a politica, a linha do A simplesmente nao esta la
    // para ser alcancada.
    const r = await comTenant(app, tenantB, (tx) =>
      tx.digitalPresenceAudit.updateMany({
        where: { id: auditA },
        data: { errorCode: 'INVASAO' },
      }),
    );
    expect(r.count).toBe(0);

    const depois = await admin.digitalPresenceAudit.findUniqueOrThrow({ where: { id: auditA } });
    expect(depois.errorCode).toBeNull();
  });
});
