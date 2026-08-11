'use client';

import { Download, Loader2, Lock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

/**
 * Exportação CSV da listagem.
 *
 * O botão aparece em todos os planos, e o bloqueio acontece na tentativa.
 * Esconder o botão de quem não tem direito parece elegante e é pior: a pessoa
 * não descobre que o recurso existe, e o upgrade nunca é considerado. Também
 * seria incoerente com a regra que o resto do produto segue — gate age depois
 * da ação, nunca antes.
 *
 * O download passa por fetch e blob, não por `<a href>` direto: a API vive em
 * outra porta e precisa do cookie de sessão, e o 403 precisa virar mensagem na
 * tela em vez de página de erro do navegador.
 */
export function ExportLeadsButton({ query }: { query: string }) {
  const [busy, setBusy] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErro(null);
    setBloqueado(false);

    try {
      const response = await fetch(
        `${API_URL}/api/v1/leads/export${query ? `?${query}` : ''}`,
        { credentials: 'include' },
      );

      if (response.status === 403) {
        setBloqueado(true);
        return;
      }

      if (!response.ok) {
        setErro('Não foi possível exportar. Tente novamente.');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Nome vindo do Content-Disposition, com carimbo de data do servidor.
      const disposition = response.headers.get('content-disposition') ?? '';
      const nome = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'leads.csv';

      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      link.click();

      // Sem o revoke o blob fica na memória da aba até o reload.
      URL.revokeObjectURL(url);
    } catch {
      setErro('Não foi possível falar com o servidor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void exportar()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Exportar CSV
      </button>

      {bloqueado ? (
        <div className="rounded-card border border-warning/30 bg-warning/5 p-3 text-right">
          <p className="flex items-center justify-end gap-2 text-xs font-semibold text-navy-900">
            <Lock className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            Exportação não disponível no seu plano
          </p>
          <Link
            href="/subscription"
            className="mt-2 inline-block rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
          >
            Ver planos
          </Link>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
