'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';

/**
 * Recalcula o score deste lead com o motor deterministico — o mesmo do worker
 * e do seed. Existe porque nicho e regiao valem +15 e +5: quem ajusta as
 * preferencias em Configuracoes precisa de um caminho para ver o efeito num
 * lead sem reprocessar a base inteira.
 */
export function RecalculateScoreButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void (async () => {
            if (busy) return;
            setBusy(true);
            setError(null);

            try {
              await clientApi(`/leads/${leadId}/recalculate-score`, { method: 'POST' });
              router.refresh();
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : 'Falha ao recalcular.',
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
        className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Recalcular
      </button>
    </div>
  );
}
