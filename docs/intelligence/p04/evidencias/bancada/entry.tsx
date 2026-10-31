import { chaveDeIdentidade, type SessionResponse } from '@propectai/types';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExplorerWorkspace } from '@/components/intelligence/explorer-workspace';

/**
 * Emulacao BANCADA de `app/(app)/layout.tsx` + `app/(app)/intelligence/page.tsx`:
 * a cada `router.refresh()` (evento 'pa-refresh') le a sessao no "servidor" e
 * (a) manda para /login se nao houver sessao (layout) ou
 * (b) re-renderiza o workspace com `key={identidade}` (pagina).
 * Usa a MESMA funcao `chaveDeIdentidade` do produto. Nao e o runtime do Next.
 */
async function lerSessao(): Promise<SessionResponse | null> {
  try {
    const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
    return r.ok ? ((await r.json()) as SessionResponse) : null;
  } catch { return null; }
}
function Pagina() {
  const [estado, setEstado] = useState<{ carregado: boolean; sessao: SessionResponse | null }>({ carregado: false, sessao: null });
  useEffect(() => {
    const ler = () => void lerSessao().then((s) => setEstado({ carregado: true, sessao: s }));
    ler();
    window.addEventListener('pa-refresh', ler);
    return () => window.removeEventListener('pa-refresh', ler);
  }, []);
  if (!estado.carregado) return null;
  if (!estado.sessao) return <p data-testid="bench-login">redirect: /login</p>;
  const identidade = chaveDeIdentidade(estado.sessao);
  return (
    <>
      <p data-testid="bench-sessao" style={{ fontSize: 11 }}>{estado.sessao.tenant?.slug}/{estado.sessao.user.id}</p>
      <ExplorerWorkspace key={identidade} identidade={identidade} />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: '24px 20px', maxWidth: 1700, margin: '0 auto' }}><Pagina /></main>,
);
