'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

/**
 * Estado de erro do App Shell.
 *
 * Substitui a página em branco por algo acionável. Mostra o código técnico
 * de forma expansível — útil para reportar, sem poluir a tela de quem só
 * quer tentar de novo.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="pa-card mx-auto max-w-lg px-6 py-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>

      <h1 className="mt-4 text-base font-semibold text-navy-900">
        Não foi possível carregar esta tela
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        A API pode estar reiniciando ou sua sessão expirou. Tentar de novo
        costuma resolver.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Tentar novamente
      </button>

      {error.digest ? (
        <details className="mt-5 text-left">
          <summary className="cursor-pointer text-xs text-muted">
            Detalhe técnico
          </summary>
          <p className="mt-2 rounded-control bg-surface-soft px-3 py-2 font-mono text-[11px] text-muted">
            {error.digest}
          </p>
        </details>
      ) : null}
    </div>
  );
}
