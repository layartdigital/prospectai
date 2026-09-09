import { PrismaClient } from '@prisma/client';

/**
 * Client do worker que enxerga **a lista de tenants**, e so ela.
 *
 * Irmao do `prisma-app.ts`, e o oposto dele em intencao: aquele existe para nao
 * ignorar nada, este existe porque uma rotina periodica precisa saber sobre
 * quais workspaces perguntar antes de poder perguntar sob a politica.
 *
 * ---
 *
 * **Por que ele passou a ser necessario, e por que nao era antes.**
 *
 * Ate hoje o worker so agia a mando de alguem: todo job carrega o `tenantId` de
 * quem pediu, e o `comTenant` basta. A peca 3 da D6 e a primeira coisa que o
 * worker faz **sem pedido** — o aviso de expiracao roda por relogio, e nao tem
 * de quem herdar o tenant.
 *
 * ---
 *
 * **O escopo desta frase foi corrigido pelo banco, e vale registrar o erro.**
 *
 * A primeira versao dizia que este client faria a descoberta inteira: um
 * `groupBy` cross-tenant em `digital_presence_checks`, numa consulta so. O
 * Postgres recusou com `42501 permission denied` — **privilegio, nao RLS**: o
 * papel `propectai_sistema` nunca recebeu `SELECT` naquela tabela, e a
 * migration `rls_papel_sistema_estreitar` diz que isso e proposital:
 * *"o sintoma sera `permission denied` — alto e imediato —, que e o mesmo
 * principio de nao haver `ALTER DEFAULT PRIVILEGES` para este papel"*.
 *
 * Tabela nova nascer invisivel para o papel do sistema e o desenho, para que
 * todo alargamento seja deliberado. **A saida certa nao era conceder tres
 * `GRANT`; era mudar a rota.** Hoje este client faz uma consulta so —
 * `tenant.findMany` — e todo o resto do job passa por `comTenant` com o papel
 * da aplicacao, sob a politica como qualquer outra leitura de dado de tenant.
 *
 * `SELECT ON tenants` ele tem desde que nasceu, para guard, billing e painel.
 * Nada aqui alarga nada.
 *
 * ---
 *
 * **Por que ele nao pode ser o `prisma-app.ts`.**
 *
 * A tabela `tenants` tem politica. Com o papel da aplicacao e sem contexto de
 * tenant posto, `tenant.findMany` devolve **zero linhas, sem erro** — o job
 * varreria zero workspaces todo dia e nada no log diria isso.
 *
 * ---
 *
 * **A direcao do fallback foi escolhida, nao herdada.**
 *
 * Faltando a variavel, cai no `DATABASE_URL` — o dono — e avisa alto. Nao e o
 * ideal, e o menos ruim: o dono enxerga todos os tenants, entao o defeito e
 * "privilegio a mais, em voz alta". Cair no papel da aplicacao seria o oposto,
 * e o pior modo de falha que existe aqui: **nenhuma linha, nenhum erro, nenhum
 * aviso enviado**, indistinguivel de um dia em que nada expirava.
 *
 * ---
 *
 * **Isto precisa de canario, e nao de confianca.** Que o papel realmente
 * enxergue mais de um tenant e afirmacao sobre o banco, nao sobre este arquivo
 * — mesma razao de existir do `rls-canario.spec.ts`. O
 * `avisar-expiracao.spec.ts` cria dado vencendo em dois tenants e exige aviso
 * nos dois; foi ele que derrubou a versao anterior deste comentario.
 */

let avisou = false;

export function criarPrismaSistema(): PrismaClient {
  const url = process.env.DATABASE_URL_SISTEMA;

  if (url === undefined || url.trim() === '') {
    if (!avisou) {
      console.warn(
        '[db] DATABASE_URL_SISTEMA ausente — conectando como dono das tabelas. ' +
          'A enumeracao funciona, mas com privilegio maior que o desenhado. ' +
          'Ver apps/worker/src/db/prisma-sistema.ts.',
      );
      avisou = true;
    }
    return new PrismaClient();
  }

  return new PrismaClient({ datasourceUrl: url });
}
