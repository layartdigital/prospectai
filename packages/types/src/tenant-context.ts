/**
 * Contexto de tenant para o Postgres.
 *
 * Este arquivo nao importa Prisma nem NestJS, como o resto do pacote. Ele
 * guarda **o que a API, o worker e a politica de RLS precisam concordar** — e
 * nada alem disso. O involucro que abre a transacao mora em cada app, porque
 * depende do client.
 */

/**
 * Nome do parametro de sessao que carrega o tenant ativo.
 *
 * Este literal precisa aparecer identico em tres lugares: o `set_config` da
 * API, o do worker, e o `current_setting` dentro da politica de RLS. Se dois
 * deles divergirem por uma letra, o sintoma no passo 4 e **zero linhas, sem
 * erro** — a politica procura um parametro que ninguem definiu e nega tudo.
 *
 * Um literal digitado em tres arquivos e um convite a essa divergencia. Daqui
 * ele sai de um lugar so.
 *
 * O prefixo `app.` nao e enfeite: o Postgres exige que parametro customizado
 * tenha prefixo com ponto, senao o `set_config` falha com "unrecognized
 * configuration parameter".
 */
export const TENANT_SETTING = 'app.tenant_id';

export class TenantIdInvalido extends Error {
  constructor(motivo: string) {
    super(`tenantId invalido para o contexto do banco: ${motivo}`);
    this.name = 'TenantIdInvalido';
  }
}

/**
 * Confere o unico defeito que o banco nao denuncia.
 *
 * **Nao ha validacao de formato aqui, e e deliberado.** O valor entra por
 * parametro de statement preparado, entao injecao nao e o risco — `set_config`
 * e funcao, e funcao aceita parametro (ao contrario de `SET LOCAL`, que exige
 * literal e por isso nao serve). Inventar um regex de cuid so criaria um jeito
 * novo de recusar um id legitimo.
 *
 * O que precisa ser recusado e o **vazio**. Um tenantId em branco define o
 * parametro como string vazia, e a politica passa a comparar `tenantId = ''`:
 * zero linhas, sem erro, com a causa a tres camadas de distancia. Enquanto o
 * RLS estiver desligado, o mesmo id vazio simplesmente nao faz nada — o defeito
 * fica dormindo ate o passo 4. Melhor estourar agora.
 */
export function validarTenantId(valor: unknown): string {
  if (typeof valor !== 'string') {
    throw new TenantIdInvalido(`esperava string, veio ${typeof valor}`);
  }
  if (valor.trim() === '') {
    throw new TenantIdInvalido('vazio');
  }
  return valor;
}
