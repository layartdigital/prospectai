'use client';

import type { LeadFacets } from '@propectai/types';
import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * Filtros na URL, não em estado local.
 *
 * Assim o usuário pode compartilhar um recorte, voltar pelo histórico do
 * navegador e recarregar sem perder o que filtrou.
 */
export function LeadsFilters({ facets }: { facets: LeadFacets }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      // Qualquer mudança de filtro volta para a primeira página.
      params.delete('page');

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const toggle = (key: string) => {
    apply({ [key]: searchParams.get(key) === 'true' ? null : 'true' });
  };

  const isOn = (key: string) => searchParams.get(key) === 'true';
  const hasFilters = Array.from(searchParams.keys()).some((key) => key !== 'page');

  function handleSearch(event: FormEvent): void {
    event.preventDefault();
    apply({ search: search.trim() || null });
  }

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      active
        ? 'border-brand-600 bg-brand-600 text-white'
        : 'border-line bg-surface text-muted hover:text-navy-900',
    );

  const select =
    'rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900';

  return (
    <div className="pa-card mb-4 flex flex-wrap items-center gap-2 p-3">
      <form onSubmit={handleSearch} className="relative flex-1 basis-56">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar empresa…"
          aria-label="Buscar empresa"
          className="w-full rounded-control border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-navy-900 placeholder:text-muted"
        />
      </form>

      <select
        aria-label="Estado"
        className={select}
        value={searchParams.get('stateUf') ?? ''}
        onChange={(event) => apply({ stateUf: event.target.value || null })}
      >
        <option value="">Todos os estados</option>
        {facets.states.map((state) => (
          <option key={state} value={state}>
            {state}
          </option>
        ))}
      </select>

      <select
        aria-label="Categoria"
        className={select}
        value={searchParams.get('category') ?? ''}
        onChange={(event) => apply({ category: event.target.value || null })}
      >
        <option value="">Todos os nichos</option>
        {facets.categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>

      <select
        aria-label="Etapa"
        className={select}
        value={searchParams.get('stageSlug') ?? ''}
        onChange={(event) => apply({ stageSlug: event.target.value || null })}
      >
        <option value="">Todas as etapas</option>
        {facets.stages.map((stage) => (
          <option key={stage.slug} value={stage.slug}>
            {stage.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={chip(isOn('withoutOwnWebsite'))}
        onClick={() => toggle('withoutOwnWebsite')}
      >
        Sem site próprio
      </button>

      <button
        type="button"
        className={chip(isOn('likelyWhatsapp'))}
        onClick={() => toggle('likelyWhatsapp')}
      >
        WhatsApp provável
      </button>

      <button
        type="button"
        className={chip(isOn('favoritesOnly'))}
        onClick={() => toggle('favoritesOnly')}
      >
        Favoritos
      </button>

      <button
        type="button"
        className={chip(searchParams.get('minScore') === '70')}
        onClick={() =>
          apply({ minScore: searchParams.get('minScore') === '70' ? null : '70' })
        }
      >
        Alta oportunidade
      </button>

      {hasFilters ? (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="ml-auto inline-flex items-center gap-1 rounded-control px-2 py-1.5 text-xs text-muted hover:text-navy-900"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Limpar
        </button>
      ) : null}
    </div>
  );
}
