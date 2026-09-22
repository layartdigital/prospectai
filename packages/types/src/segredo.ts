/**
 * Endereco de conexao sem a senha, para ir para log.
 *
 * Existe desde 22/09/2026. Ate entao a API registrava, a cada subida,
 * `Conectado ao Redis em redis://:<senha>@redis:6379`, e o worker gravava o
 * mesmo endereco no campo `redis` do log de inicio. Descoberto no primeiro
 * deploy com o codigo de setembro: a senha do Redis de producao apareceu
 * inteira no `docker logs` — e em tudo o que copia esse log.
 *
 * Expressao regular e nao `new URL()` de proposito: este pacote e compilado
 * sem os tipos do Node, e a regra e pequena o bastante para caber numa linha
 * testada. Troca so o que fica entre `usuario:` e `@` logo depois do esquema;
 * endereco sem senha (`redis://localhost:6381`) passa inalterado.
 */
const SENHA_NA_URL = /^([a-z][a-z0-9+.-]*:\/\/[^:@/]*:)[^@/]*@/i;

export function urlSemSenha(url: string): string {
  return url.replace(SENHA_NA_URL, '$1***@');
}
