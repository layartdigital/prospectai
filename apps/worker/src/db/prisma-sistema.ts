import { PrismaClient } from '@prisma/client';
import { exigirUrlDoBanco } from '@propectai/types';

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
 * **Faltando a variavel, o worker nao sobe** (DB-REM-01).
 *
 * A versao anterior escolhia entre duas quedas e registrava por que: cair no
 * dono era "privilegio a mais, em voz alta"; cair no papel da aplicacao seria
 * o pior modo de falha daqui — **nenhuma linha, nenhum erro, nenhum aviso
 * enviado**, indistinguivel de um dia em que nada expirava. O raciocinio sobre
 * a segunda continua certo. A saida que nenhuma das duas oferecia e nao cair:
 * recusar subir nao tem privilegio a mais e nao e silenciosa. Ver
 * `exigirUrlDoBanco` em `@propectai/types`.
 *
 * ---
 *
 * **Isto precisa de canario, e nao de confianca.** Que o papel realmente
 * enxergue mais de um tenant e afirmacao sobre o banco, nao sobre este arquivo
 * — mesma razao de existir do `rls-canario.spec.ts`. O
 * `avisar-expiracao.spec.ts` cria dado vencendo em dois tenants e exige aviso
 * nos dois; foi ele que derrubou a versao anterior deste comentario.
 */

export function criarPrismaSistema(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: exigirUrlDoBanco(process.env, 'DATABASE_URL_SISTEMA'),
  });
}
