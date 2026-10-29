import { PrismaClient } from '@prisma/client';
import { exigirUrlDoBanco } from '@propectai/types';

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
 * Reverter o passo 4 continua sendo uma linha do `.env`, agora explicita:
 * apontar `DATABASE_URL_APP` para a URL do dono.
 *
 * ---
 *
 * **Sem a variavel, o worker nao sobe** (DB-REM-01). Ate entao ele caia no
 * `DATABASE_URL` em voz alta, no mesmo padrao do `criarPrismaAdmin` — e o
 * silencio que o aviso combatia so era evitado se alguem lesse o log: a
 * aplicacao conectava como dono, o `FORCE` deixava de valer, e **tudo
 * continuava funcionando**. O `criarPrismaAdmin` dos testes mantem a queda,
 * porque la conectar como dono e o objetivo. Ver `exigirUrlDoBanco` em
 * `@propectai/types`.
 */

export function criarPrismaApp(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: exigirUrlDoBanco(process.env, 'DATABASE_URL_APP'),
  });
}
