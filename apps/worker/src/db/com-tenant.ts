import type { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_SETTING, validarTenantId } from '@propectai/types';

/**
 * Contexto de tenant no worker.
 *
 * Gemeo do `PrismaService.comTenant` da API. **A duplicacao e conhecida e foi
 * escolhida**: o worker nao tem NestJS e os dois apps nao dependem um do outro,
 * entao unificar exigiria um pacote `@propectai/db` novo — com tsconfig,
 * entrada no turbo e build proprio — para hospedar dez linhas.
 *
 * O que **nao** foi duplicado e o que podia divergir em silencio: o nome do
 * parametro e a validacao vivem em `@propectai/types`. O que sobra aqui e o
 * involucro do client, e um involucro divergente falha alto, no typecheck ou na
 * primeira execucao.
 *
 * Se o passo 6 espalhar isto por muitos modulos, o pacote passa a valer o
 * custo. Hoje nao vale.
 *
 * As duas regras de uso sao as mesmas, e estao escritas por extenso no
 * `apps/api/src/prisma/prisma.service.ts`: **nada de I/O externo aqui dentro**,
 * e **nao engula erro aqui dentro** — depois de um erro o Postgres aborta a
 * transacao e o `COMMIT` vira `ROLLBACK` sem lancar.
 */

const TX_TIMEOUT_MS = 10_000;
const TX_MAX_WAIT_MS = 5_000;

export async function comTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  // `async` de proposito: assim a recusa de um tenantId invalido chega como
  // promise rejeitada, e nao como excecao sincrona. Quem chama trata um caminho
  // de erro so.
  const id = validarTenantId(tenantId);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${id}, true)`;
      return fn(tx);
    },
    { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
  );
}
