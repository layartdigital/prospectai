'use client';

import type { LeadFacets, LeadListItem } from '@propectai/types';
import { Loader2, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { FiltroLeads } from '@/lib/intelligence-api';

interface Props {
  filtro: FiltroLeads;
  onFiltro: (f: FiltroLeads) => void;
  facetas: LeadFacets | null;
  resultados: LeadListItem[];
  total: number;
  carregando: boolean;
  erro: string | null;
  selecionadoId: string | null;
  onEscolher: (leadId: string) => void;
}

const campo =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-navy-900 placeholder:text-muted focus-visible:border-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600/30';

export function EntitySearchPanel({
  filtro,
  onFiltro,
  facetas,
  resultados,
  total,
  carregando,
  erro,
  selecionadoId,
  onEscolher,
}: Props) {
  return (
    <section className="pa-card p-4" aria-label="Buscar lead" data-tour="explorer-search">
      <h2 className="text-card-title text-navy-900">Escolher o lead de partida</h2>

      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="sr-only">Buscar lead pelo nome</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={filtro.search}
              onChange={(e) => onFiltro({ ...filtro, search: e.target.value })}
              placeholder="Nome da empresa"
              className={cn(campo, 'pl-8')}
              maxLength={120}
            />
          </div>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-label uppercase tracking-wide text-muted">Cidade</span>
            <select
              value={filtro.city}
              onChange={(e) => onFiltro({ ...filtro, city: e.target.value })}
              className={campo}
              disabled={!facetas}
            >
              <option value="">Todas</option>
              {facetas?.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-label uppercase tracking-wide text-muted">Categoria</span>
            <select
              value={filtro.category}
              onChange={(e) => onFiltro({ ...filtro, category: e.target.value })}
              className={campo}
              disabled={!facetas}
            >
              <option value="">Todas</option>
              {facetas?.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-3" aria-live="polite">
        {carregando ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Buscando leads…
          </p>
        ) : erro ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
            {erro}
          </p>
        ) : resultados.length === 0 ? (
          <p className="text-xs text-muted">
            {facetas && facetas.categories.length === 0 && !filtro.search
              ? 'Este workspace ainda não tem leads. Faça uma Nova Busca para começar.'
              : 'Nenhum lead encontrado com estes filtros.'}
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] text-muted">
              {resultados.length} de {total} lead{total === 1 ? '' : 's'}, do maior score para o menor
            </p>
            <ul className="space-y-1.5">
              {resultados.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => onEscolher(l.id)}
                    aria-current={l.id === selecionadoId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-control border px-3 py-2 text-left transition-colors',
                      l.id === selecionadoId
                        ? 'border-brand-600 bg-brand-50'
                        : 'border-line bg-surface hover:border-brand-600',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-navy-900">{l.name}</span>
                      <span className="shrink-0 rounded-full bg-navy-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {l.score}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {[l.category, l.city && l.stateUf ? `${l.city}/${l.stateUf}` : l.city].filter(Boolean).join(' · ') || 'sem categoria'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
