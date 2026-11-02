import type { Metadata } from 'next';
import { chaveDeIdentidade } from '@propectai/types';
import { Suspense } from 'react';

import { ExplorerWorkspace } from '@/components/intelligence/explorer-workspace';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Intelligence Explorer' };

/**
 * O workspace é um componente de cliente porque o grafo é interativo; todo dado vem
 * da API autenticada. O `Suspense` é exigido pelo App Router para `useSearchParams`.
 *
 * P04-QA-02: a página lê a identidade da sessão (usuário + workspace) no servidor e a
 * usa como `key` do workspace. Quando a identidade muda — logout em outra aba, outro
 * usuário no mesmo navegador, outro workspace — `router.refresh()` entrega uma chave
 * nova e o React DESMONTA o workspace inteiro: grafo, detalhes, seleção, cursores,
 * resultados de busca e requisições pendentes vão embora, em vez de ficarem na tela
 * até alguém clicar. A chave também é a referência que o vigia de sessão compara com
 * `/auth/me`.
 */
export default async function IntelligencePage() {
  const identidade = chaveDeIdentidade(await getSession());

  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <ExplorerWorkspace key={identidade} identidade={identidade} />
    </Suspense>
  );
}
