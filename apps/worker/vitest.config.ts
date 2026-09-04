import { defineConfig } from 'vitest/config';

/**
 * Vitest do worker.
 *
 * Escolhido para alinhar com packages/types, que ja usa Vitest. A API usa Jest
 * por causa do ecossistema Nest — divergencia consciente, nao acidente.
 *
 * Exige `pnpm --filter @propectai/types build` antes: o worker importa
 * @propectai/types pelo `exports` do pacote, que aponta para dist.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],

    // Serial e com folga de tempo pelo mesmo motivo do Jest da API: as suites
    // falam com o banco real e o mock provider simula 1s de trabalho por job,
    // com polling de 3s. Paralelizar aqui produz contencao de engine do Prisma
    // e falso negativo com cara de falha de infraestrutura.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});

/**
 * ⚠ Instabilidade conhecida e NAO explicada — 04/09/2026.
 *
 * Na execucao #3 do CI, o `com-tenant.spec.ts` **nao apareceu na saida**: o
 * processo do vitest morreu antes de reportar qualquer coisa.
 *
 *     Error: Worker exited unexpectedly
 *       ❯ ChildProcess.onUnexpectedExit  tinypool/dist/index.js:118:30
 *
 *     Test Files  10 passed (11)
 *          Tests  197 passed (202)
 *         Errors  1 error
 *
 * **Re-executado sem mudar uma linha de codigo, passou.**
 *
 * ---
 *
 * **O que ja foi descartado, para ninguem refazer o caminho:**
 *
 * - **Nao e paralelismo entre arquivos.** O `fileParallelism: false` acima ja
 *   estava ativo, e o `isolate` do pool esta no padrao (`true`) — cada arquivo
 *   roda sozinho, num processo novo. O processo que morreu estava rodando **so**
 *   o `com-tenant.spec.ts`, do inicio ao fim. Mexer nesta configuracao para
 *   "resolver" isto e trocar um defeito conhecido por um desconhecido.
 * - **Nao ha OOM, sinal nem limite de conexao no log.** Procurado por
 *   `out of memory`, `ENOMEM`, `SIGKILL`, `SIGSEGV`, `too many clients`: nada.
 *   O processo sumiu sem deixar mensagem.
 * - **Nao e lentidao do runner.** O `scrape-pipeline` levou 22 s no CI contra
 *   43 s numa maquina de desenvolvimento — o runner estava mais rapido.
 *
 * **O que se sabe do arquivo:** e o unico do worker que abre **dois** clients
 * Prisma no escopo do modulo (`criarPrismaApp` e `criarPrismaAdmin`) e chama
 * `$connect()` nos dois em `Promise.all` dentro do `beforeAll`. Isso e uma
 * observacao, nao um diagnostico.
 *
 * ---
 *
 * **O limiar, combinado antes de alguem estar irritado:** se isto acontecer
 * **mais de uma vez nas proximas dez execucoes**, investiga-se a serio. Abaixo
 * disso e ruido — uma vermelha em duas execucoes nao e uma taxa, e agir sobre
 * n=2 e agir sobre barulho.
 *
 * Combinar o numero antes evita os dois erros: gastar tempo com ruido, e
 * normalizar o vermelho por nunca ter decidido quando reagir.
 *
 * **A protecao da branch `main` espera esta medicao.** Exigir CI verde para
 * aceitar push, com uma suite de taxa de falha desconhecida, ensina a contornar
 * o portao — que e a unica forma de perder o valor que ele acabou de provar ter.
 *
 * ---
 *
 * **E uma nota sobre a forma do relatorio**, que vale alem deste caso: o vitest
 * resumiu como `Test Files 10 passed (11)`. **Suite que morre nao conta como
 * suite que falhou** — ela some da contagem. O `Errors 1 error` e a saida 1
 * salvaram o build, mas "10 passed" lido de relance parece sucesso. Ao ler uma
 * execucao do worker, conferir o numero entre parenteses.
 */
