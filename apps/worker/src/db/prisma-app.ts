import { PrismaClient } from '@prisma/client';

/**
 * Client de execucao do worker, com o papel que **esta** sujeito a politica.
 *
 * Passo 4 do `PLANO-RLS-v1.md`. Gemeo do `criarPrismaAdmin()` dos testes, e o
 * oposto dele em intencao: aquele existe para ignorar RLS ao montar cenario,
 * este existe para nao ignorar nada.
 *
 * ---
 *
 * **Por que uma variavel nova, e nao trocar o `DATABASE_URL`.**
 *
 * O plano dizia "app aponta para `propectai_app`", e a forma obvia seria
 * trocar o `DATABASE_URL`. So que o Prisma CLI le exatamente essa variavel:
 * `migrate`, `db:seed`, `db:studio` e os scripts `set-plan`, `reset-quota` e
 * `import-segments` passariam todos a conectar como um papel sem DDL. A
 * proxima migration falharia, e o seed junto.
 *
 * `directUrl` no schema resolveria o `migrate` e deixaria o `seed.ts` e os
 * scripts conectando como aplicacao do mesmo jeito. Entao a escolha e outra:
 * **opt-in por processo.** `DATABASE_URL` continua sendo o dono; so quem
 * executa a aplicacao le a variavel nova.
 *
 * De brinde, reverter o passo 4 vira apagar uma linha do `.env`.
 */

let avisou = false;

export function criarPrismaApp(): PrismaClient {
  const url = process.env.DATABASE_URL_APP;

  if (url === undefined || url.trim() === '') {
    /**
     * Cai no `DATABASE_URL`, mas **em voz alta** — mesmo padrao do
     * `criarPrismaAdmin`.
     *
     * O silencio aqui seria pior que o erro: a aplicacao voltaria a conectar
     * como dono, o `FORCE` deixaria de valer, e **tudo continuaria
     * funcionando**. Um teste de isolamento passaria sem que a politica
     * estivesse no caminho de nada.
     */
    if (!avisou) {
      console.warn(
        '[db] DATABASE_URL_APP ausente — conectando como dono das tabelas. ' +
          'A politica de RLS NAO esta no caminho. Ver passo 4 do PLANO-RLS-v1.md.',
      );
      avisou = true;
    }
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: url });
}
