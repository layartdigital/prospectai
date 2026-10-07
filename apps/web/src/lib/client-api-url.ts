/**
 * Endereco da API para o navegador.
 *
 * O codigo que roda no navegador nao conhece hostname, IP nem porta da API:
 * chama a propria origem, e quem encaminha `/api` e a borda da arquitetura.
 *
 *   producao          gateway nginx     location /api/ -> api:3101
 *   desenvolvimento   rewrite do Next   /api/:path*    -> API local
 *
 * Ate 07/10/2026 cada componente lia `NEXT_PUBLIC_API_URL`. O Next resolve
 * `NEXT_PUBLIC_*` em tempo de BUILD e grava o valor dentro do JavaScript
 * entregue ao navegador: o endereco publico do ambiente ficava compilado na
 * imagem da web, e trocar de endereco exigia reconstruir a imagem. Medido no
 * bundle de producao em 07/10/2026.
 *
 * O prefixo tambem e usado pelo lado servidor (`lib/api.ts`), que o prefixa
 * com o endereco interno da API. Por isso este modulo nao le ambiente, nao
 * marca `'use client'` e nao toca no DOM: e construcao de string.
 */
export const API_PREFIX = '/api/v1';

/** Caminho same-origin da API: `'/auth/login'` -> `'/api/v1/auth/login'`. */
export function clientApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${normalized}`;
}
