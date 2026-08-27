import path from 'node:path';

import type { Prisma } from '@prisma/client';
import { TENANT_SETTING, TenantIdInvalido } from '@propectai/types';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { comTenant } from '../src/db/com-tenant';
import { criarPrismaApp } from '../src/db/prisma-app';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * O contexto de tenant — passo 3 do `PLANO-RLS-v1.md`.
 *
 * **Este e o arquivo que impede o passo 4 de falhar de forma muda.** Os tres
 * modos de falha do `SPIKE-RLS-v1.md` sao silenciosos, e o `comTenant` tem os
 * seus proprios: se o valor nao chegar ao Postgres, ou vazar entre transacoes,
 * nada quebra hoje — quebra no passo 4, e quebra como "zero linhas", que nao
 * aponta para lugar nenhum.
 *
 * Enquanto o RLS estiver desligado, nenhuma outra coisa neste repositorio le
 * `app.tenant_id`. Sem estas quatro asseroes, o `comTenant` seria codigo
 * exercitado por toda a suite e verificado por ninguem.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const admin = criarPrismaAdmin();
const prisma = criarPrismaApp();
const sufixo = Date.now().toString(36);
const TIMEOUT_HOOK_MS = 60_000;

let tenantId = '';

beforeAll(async () => {
  await Promise.all([admin.$connect(), prisma.$connect()]);
  const t = await admin.tenant.create({
    data: { name: `Tenant ComTenant ${sufixo}`, slug: `comtenant-${sufixo}`, isDemo: true },
  });
  tenantId = t.id;
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await Promise.all([admin.$disconnect(), prisma.$disconnect()]);
}, TIMEOUT_HOOK_MS);

/**
 * `Prisma.TransactionClient` aceita tanto o `tx` quanto o client inteiro, o que
 * e justamente o que este arquivo precisa: ler o contexto de dentro e de fora
 * da transacao com a mesma funcao.
 */
async function lerContexto(client: Prisma.TransactionClient): Promise<string> {
  const linhas = await client.$queryRaw<Array<{ v: string }>>`
    SELECT coalesce(current_setting(${TENANT_SETTING}, true), '') AS v`;
  return linhas[0]?.v ?? '';
}

describe('comTenant', () => {
  it('o tenant chega ao Postgres dentro da transacao', async () => {
    /**
     * A asserção parece trivial e nao e. `set_config(..., true)` **fora** de
     * transacao explicita nao falha: ele nao faz nada — o valor morre no fim
     * do proprio statement. Medido no Postgres 16:
     *
     *     set_config('app.tenant_id','x',true)   -> devolve 'x'
     *     current_setting('app.tenant_id', true) -> vazio
     *
     * Se alguem "simplificar" o `comTenant` tirando a transacao, tudo continua
     * verde ate o passo 4, quando a politica passa a negar tudo.
     */
    const visto = await comTenant(prisma, tenantId, (tx) => lerContexto(tx));
    expect(visto).toBe(tenantId);
  });

  it('o tenant nao sobrevive a transacao', async () => {
    /**
     * O `is_local = true` e o que separa isto de um vazamento entre clientes.
     * Sem ele o valor ficaria colado na **conexao**, e o pool entregaria essa
     * conexao ao proximo tenant com o contexto do anterior ainda definido.
     */
    await comTenant(prisma, tenantId, (tx) => lerContexto(tx));
    expect(await lerContexto(prisma)).toBe('');
  });

  it('tenants diferentes nao se misturam em sequencia', async () => {
    const a = await comTenant(prisma, tenantId, (tx) => lerContexto(tx));
    const b = await comTenant(prisma, 'outro-tenant-qualquer', (tx) => lerContexto(tx));
    expect(a).toBe(tenantId);
    expect(b).toBe('outro-tenant-qualquer');
  });

  it('erro dentro desfaz o que ja tinha sido escrito', async () => {
    /**
     * Atomicidade e o efeito colateral do passo 3, e vale ter prova: e ela que
     * torna aceitavel juntar checagens, cota e registro num bloco so no
     * `process-audit-job.ts`.
     */
    const antes = await admin.auditLog.count({ where: { tenantId } });

    await expect(
      comTenant(prisma, tenantId, async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'teste.rollback',
            entityType: 'Teste',
            entityId: 'x',
          },
        });
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');

    expect(await admin.auditLog.count({ where: { tenantId } })).toBe(antes);
  });

  it('tenant vazio e recusado antes de abrir transacao', async () => {
    let entrou = false;
    await expect(
      comTenant(prisma, '', async () => {
        entrou = true;
      }),
    ).rejects.toThrow(TenantIdInvalido);

    // O callback nao roda: recusar depois de abrir a transacao gastaria uma
    // conexao para nada, e — pior — deixaria passar a hipotese de que o
    // contexto vazio foi definido.
    expect(entrou).toBe(false);
  });
});
