import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ExplorerWorkspace } from '@/components/intelligence/explorer-workspace';

export const metadata: Metadata = { title: 'Intelligence Explorer' };

/**
 * O workspace é um componente de cliente porque o grafo é interativo; a
 * sessão e o tenant já foram resolvidos pelo layout `(app)`, e todo dado vem da
 * API autenticada. O `Suspense` é exigido pelo App Router para `useSearchParams`.
 */
export default function IntelligencePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
      <ExplorerWorkspace />
    </Suspense>
  );
}
