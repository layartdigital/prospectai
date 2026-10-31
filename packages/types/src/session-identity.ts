/**
 * Identidade de sessao: "quem" e "em qual workspace" uma tela esta mostrando dados.
 *
 * P04-QA-02 (31/10/2026). Telas com estado em memoria que vem da API (o grafo do
 * Intelligence Explorer, por exemplo) precisam saber quando o dono desse estado
 * mudou — logout em outra aba, login de outro usuario no mesmo navegador, troca de
 * workspace. Recusar a requisicao seguinte no servidor (HMAC, RLS) protege o dado,
 * mas NAO limpa a tela: o grafo do workspace anterior continuaria visivel.
 *
 * A chave abaixo e comparada entre o que o servidor entregou ao montar a tela e o
 * que `GET /auth/me` devolve agora. Funcao pura: sem relogio, sem rede, testavel.
 */

export interface IdentidadeMinima {
  user?: { id: string } | null;
  tenant?: { id: string } | null;
}

/** Sem usuario => sem sessao. Sem tenant => workspace null (conta sem tenant ativo). */
export function chaveDeIdentidade(sessao: IdentidadeMinima | null | undefined): string {
  const usuario = sessao?.user?.id;
  if (!usuario) return 'sem-sessao';
  // JSON: sem delimitador ambiguo entre usuario e tenant (ids contendo '|' nao colidem).
  return JSON.stringify([usuario, sessao?.tenant?.id ?? null]);
}

export type VeredictoDeIdentidade = 'IGUAL' | 'MUDOU';

/**
 * `inicial` e a chave com que a tela foi montada; `atual` e a chave lida agora.
 * Qualquer diferenca — inclusive "sem sessao" — invalida o estado da tela.
 */
export function compararIdentidade(inicial: string, atual: string): VeredictoDeIdentidade {
  return inicial === atual ? 'IGUAL' : 'MUDOU';
}
