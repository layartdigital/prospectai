'use client';

import {
  BRAZIL_STATES,
  SUGGESTED_NICHES,
  type SearchQuotaResponse,
  type SearchStatusResponse,
} from '@propectai/types';
import { AlertCircle, CheckCircle2, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';

const POLL_MS = 1500;

export function SearchForm({ quota }: { quota: SearchQuotaResponse }) {
  const router = useRouter();

  const [stateUf, setStateUf] = useState('SP');
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [radiusKm, setRadiusKm] = useState(10);
  const [requestedCount, setRequestedCount] = useState(
    Math.min(5, Math.max(1, quota.available)),
  );

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<SearchStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planBlocked, setPlanBlocked] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const noCredits = quota.available <= 0;
  const running =
    status !== null &&
    !['COMPLETED', 'FAILED', 'CANCELLED'].includes(status.status);

  async function poll(searchId: string): Promise<void> {
    try {
      const next = await clientApi<SearchStatusResponse>(
        `/prospecting/searches/${searchId}/status`,
      );
      setStatus(next);

      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(next.status)) {
        setSubmitting(false);
        router.refresh();
        return;
      }

      timer.current = setTimeout(() => void poll(searchId), POLL_MS);
    } catch {
      setSubmitting(false);
      setError('Perdemos o acompanhamento da busca. Verifique o histórico.');
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || noCredits) return;

    setSubmitting(true);
    setError(null);
    setPlanBlocked(false);
    setStatus(null);

    try {
      const created = await clientApi<{ searchId: string; jobId: string }>(
        '/prospecting/searches',
        {
          method: 'POST',
          body: JSON.stringify({
            niche: niche.trim(),
            stateUf,
            city: city.trim(),
            neighborhood: neighborhood.trim() || undefined,
            radiusKm,
            requestedCount,
          }),
        },
      );

      void poll(created.searchId);
    } catch (caught) {
      setSubmitting(false);

      // O modal de plano só aparece AQUI, depois de uma tentativa explícita.
      // Carregar a página nunca dispara bloqueio.
      if (caught instanceof ClientApiError && caught.code === 'PLAN_LIMIT') {
        setPlanBlocked(true);
        return;
      }

      setError(
        caught instanceof Error ? caught.message : 'Não foi possível criar a busca',
      );
    }
  }

  const field =
    'w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted';

  return (
    <>
      {/* Estado bloqueado precisa se explicar. Um botão desabilitado sem
          motivo visível é um beco sem saída — e este é exatamente o defeito
          que o produto existe para evitar. */}
      {noCredits ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-navy-900">
              Sem leads disponíveis neste período
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Você usou {quota.leadsUsed} dos {quota.leadsIncluded} leads do plano{' '}
              {quota.planCode}. O saldo renova no início do próximo mês.
            </p>
          </div>
          <Link
            href="/subscription"
            className="rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
          >
            Ver planos
          </Link>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="pa-card p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="state" className="pa-label mb-1.5 block">
              Estado
            </label>
            <select
              id="state"
              value={stateUf}
              onChange={(event) => setStateUf(event.target.value)}
              className={field}
            >
              {BRAZIL_STATES.map((state) => (
                <option key={state.uf} value={state.uf}>
                  {state.uf} — {state.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="city" className="pa-label mb-1.5 block">
              Cidade
            </label>
            <input
              id="city"
              required
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Ex: São Paulo"
              className={field}
            />
          </div>

          <div>
            <label htmlFor="niche" className="pa-label mb-1.5 block">
              Nicho
            </label>
            <input
              id="niche"
              required
              list="niche-suggestions"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="Buscar ou digitar nicho…"
              className={field}
            />
            <datalist id="niche-suggestions">
              {SUGGESTED_NICHES.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="neighborhood" className="pa-label mb-1.5 block">
              Bairro <span className="normal-case text-muted">(opcional)</span>
            </label>
            <input
              id="neighborhood"
              value={neighborhood}
              onChange={(event) => setNeighborhood(event.target.value)}
              placeholder="Ex: Centro, Jardins…"
              className={field}
            />
          </div>

          <div>
            <label htmlFor="radius" className="pa-label mb-1.5 block">
              Raio (km)
            </label>
            <input
              id="radius"
              type="number"
              min={1}
              max={50}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="count" className="pa-label mb-1.5 block">
              Qtd. de leads
            </label>
            <input
              id="count"
              type="number"
              min={1}
              max={Math.max(1, quota.available)}
              value={requestedCount}
              onChange={(event) => setRequestedCount(Number(event.target.value))}
              className={field}
            />
            <p className="mt-1 text-[11px] text-muted">
              {quota.available} de {quota.leadsIncluded} disponíveis no plano{' '}
              {quota.planCode}
            </p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Você só consome crédito por lead novo. Leads que já estão na sua base
          são atualizados sem custo.
        </p>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={submitting || noCredits}
            className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            {submitting ? 'Buscando…' : 'Buscar Oportunidades'}
          </button>
        </div>

        <div className="sr-only" aria-live="polite">
          {noCredits ? 'Busca indisponível: sem saldo de leads no plano.' : ''}
        </div>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {planBlocked ? (
        <div className="pa-card mt-4 border-warning/40 p-4">
          <h2 className="text-sm font-semibold text-navy-900">
            Seu plano não tem leads disponíveis
          </h2>
          <p className="mt-1 text-xs text-muted">
            Você usou {quota.leadsUsed} dos {quota.leadsIncluded} leads do plano{' '}
            {quota.planCode} neste período.
          </p>
          <Link
            href="/subscription"
            className="mt-3 inline-block rounded-control bg-brand-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Ver planos
          </Link>
        </div>
      ) : null}

      {status ? (
        <section className="pa-card mt-4 p-4">
          <div className="flex items-center gap-2">
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />
            ) : status.status === 'COMPLETED' ? (
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4 text-danger" aria-hidden="true" />
            )}
            <p className="text-sm font-semibold text-navy-900">{status.message}</p>
          </div>

          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-soft"
            role="progressbar"
            aria-valuenow={status.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status.status === 'FAILED' ? 'bg-danger' : 'bg-brand-600'
              }`}
              style={{ width: `${status.progress}%` }}
            />
          </div>

          {status.status === 'COMPLETED' ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <Metric label="Leads novos" value={status.newLeadCount} />
                <Metric label="Duplicados" value={status.duplicateCount} />
                <Metric label="Retornados" value={status.resultCount} />
              </div>
              <Link
                href="/leads"
                className="mt-4 inline-block rounded-control bg-navy-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Ver os leads encontrados
              </Link>
            </>
          ) : null}

          {status.errorMessage ? (
            <p className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
              {status.errorMessage} — os créditos foram devolvidos.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-control bg-surface-soft px-3 py-2.5">
      <p className="text-lg font-bold text-navy-900">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
