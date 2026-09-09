import { PrismaClient } from '@prisma/client';

/**
 * Client de leitura do worker que **atravessa** tenants.
 *
 * Irmao do `prisma-app.ts`, e o oposto dele em intencao: aquele existe para
 * nao ignorar nada, este existe porque uma rotina periodica precisa fazer uma
 * pergunta que nenhum tenant pode fazer.
 *
 * ---
 *
 * **Por que ele passou a ser necessario, e por que nao era antes.**
 *
 * Ate hoje o worker so agia a mando de alguem: todo job carrega o `tenantId`
 * de quem pediu, e o `comTenant` basta. A peca 3 da D6 e a primeira coisa que
 * o worker faz **sem pedido** — o aviso de expiracao roda diariamente e comeca
 * por "quais tenants tem medicoes perto do prazo?".
 *
 * Essa pergunta e cross-tenant por natureza, e sob `FORCE ROW LEVEL SECURITY`
 * o papel da aplicacao a responde com **zero linhas, sem erro**. O job passaria
 * todo dia, nao avisaria ninguem, e nada no log diria isso.
 *
 * ---
 *
 * **O que este client NAO e.**
 *
 * Ele e para a descoberta, e so. A escrita continua indo por
 * `comTenant(prismaApp, ...)`, com o papel sujeito a politica e o contexto do
 * tenant posto. Ler com um e escrever com o outro nao e cerimonia: e o que
 * mantem a politica no caminho da unica operacao que cria linha.
 *
 * ---
 *
 * **A direcao do fallback foi escolhida, nao herdada.**
 *
 * Faltando a variavel, cai no `DATABASE_URL` — o dono — e avisa alto. Nao e o
 * ideal, e o menos ruim: o dono enxerga todos os tenants, entao o defeito e
 * "privilegio a mais, em voz alta". Cair no papel da aplicacao seria o oposto,
 * e o pior modo de falha que existe aqui: **nenhuma linha, nenhum erro,
 * nenhum aviso enviado**, indistinguivel de um dia em que nada expirava.
 *
 * ---
 *
 * **Isto precisa de canario, e nao de confianca.** Que o papel realmente
 * enxergue mais de um tenant e afirmacao sobre o banco, nao sobre este arquivo
 * — mesma razao de existir do `rls-canario.spec.ts`.
 */

let avisou = false;

export function criarPrismaSistema(): PrismaClient {
  const url = process.env.DATABASE_URL_SISTEMA;

  if (url === undefined || url.trim() === '') {
    if (!avisou) {
      console.warn(
        '[db] DATABASE_URL_SISTEMA ausente — conectando como dono das tabelas. ' +
          'A descoberta funciona, mas com privilegio maior que o desenhado. ' +
          'Ver apps/worker/src/db/prisma-sistema.ts.',
      );
      avisou = true;
    }
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: url });
}
