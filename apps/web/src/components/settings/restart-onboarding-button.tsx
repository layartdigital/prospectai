'use client';

import { Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';

/**
 * Refazer o onboarding — exigencia do criterio 6 da v0.1.1.
 *
 * Nao apaga preferencia: o endpoint so limpa a data de conclusao, e o wizard
 * reabre com as respostas anteriores preenchidas. Zerar as listas derrubaria
 * dois pesos do score por um clique que a pessoa entende como "quero rever".
 */
export function RestartOnboardingButton({ completed }: { completed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await clientApi('/settings/onboarding/restart', { method: 'POST' });
      router.push('/onboarding');
      router.refresh();
    } catch (caught) {
      // 403 tem causa especifica e acionavel: o endpoint exige MANAGER.
      setError(
        caught instanceof ClientApiError && caught.statusCode === 403
          ? 'Só quem tem papel de gerente ou superior pode refazer.'
          : 'Não foi possível reabrir o onboarding.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {completed ? 'Refazer onboarding' : 'Continuar onboarding'}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
