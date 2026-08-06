'use client';

import {
  CHANNEL_OPTIONS,
  GOAL_OPTIONS,
  SERVICE_OPTIONS,
  SUGGESTED_NICHES,
  type PreferencesView,
} from '@propectai/types';
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';

import { clientApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

export function PreferencesForm({ initial }: { initial: PreferencesView }) {
  const router = useRouter();

  const [services, setServices] = useState<string[]>(initial.servicesSold);
  const [niches, setNiches] = useState<string[]>(initial.targetNiches);
  const [regions, setRegions] = useState<string[]>(initial.targetRegions);
  const [channel, setChannel] = useState(initial.preferredChannel ?? '');
  const [goal, setGoal] = useState(initial.monthlyGoal ?? '');

  const [regionDraft, setRegionDraft] = useState('');
  const [nicheDraft, setNicheDraft] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scoreStale, setScoreStale] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalculated, setRecalculated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], set: (next: string[]) => void, value: string): void {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
    setSaved(false);
  }

  function addTag(
    draft: string,
    setDraft: (value: string) => void,
    list: string[],
    set: (next: string[]) => void,
  ): void {
    const value = draft.trim();
    if (!value || list.includes(value)) return;
    set([...list, value]);
    setDraft('');
    setSaved(false);
  }

  async function save(): Promise<void> {
    if (saving) return;

    setSaving(true);
    setError(null);
    setRecalculated(null);

    try {
      const result = await clientApi<PreferencesView & { scoreAffected: boolean }>(
        '/settings/preferences',
        {
          method: 'PATCH',
          body: JSON.stringify({
            servicesSold: services,
            targetNiches: niches,
            targetRegions: regions,
            preferredChannel: channel || undefined,
            monthlyGoal: goal || undefined,
          }),
        },
      );

      setSaved(true);
      setScoreStale(result.scoreAffected);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  }

  async function recalculate(): Promise<void> {
    if (recalculating) return;

    setRecalculating(true);
    try {
      const result = await clientApi<{ updated: number }>(
        '/settings/recalculate-scores',
        { method: 'POST' },
      );
      setRecalculated(result.updated);
      setScoreStale(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível recalcular',
      );
    } finally {
      setRecalculating(false);
    }
  }

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      active
        ? 'border-brand-600 bg-brand-600 text-white'
        : 'border-line bg-surface text-muted hover:text-navy-900',
    );

  return (
    <div className="space-y-4">
      <section className="pa-card p-4">
        <h2 className="text-card-title text-navy-900">Serviço que você vende</h2>
        <p className="mt-1 text-xs text-muted">
          Alimenta o texto padrão das abordagens geradas por IA.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SERVICE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={chip(services.includes(option))}
              onClick={() => toggle(services, setServices, option)}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="pa-card p-4">
        <h2 className="text-card-title text-navy-900">Nichos que você prospecta</h2>
        <p className="mt-1 text-xs text-muted">
          Lead cuja categoria está nesta lista ganha{' '}
          <strong className="font-semibold text-navy-900">+15 no score</strong>. É o
          peso mais alto depois da ausência de site.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTED_NICHES.map((option) => (
            <button
              key={option}
              type="button"
              className={chip(niches.includes(option))}
              onClick={() => toggle(niches, setNiches, option)}
            >
              {option}
            </button>
          ))}
        </div>

        <TagInput
          id="niche-draft"
          placeholder="Adicionar outro nicho…"
          value={nicheDraft}
          onChange={setNicheDraft}
          onAdd={() => addTag(nicheDraft, setNicheDraft, niches, setNiches)}
        />

        <TagList
          items={niches.filter((item) => !SUGGESTED_NICHES.includes(item as never))}
          onRemove={(value) => {
            setNiches(niches.filter((item) => item !== value));
            setSaved(false);
          }}
        />
      </section>

      <section className="pa-card p-4">
        <h2 className="text-card-title text-navy-900">Cidades ou regiões atendidas</h2>
        <p className="mt-1 text-xs text-muted">
          Lead na sua área de atuação ganha{' '}
          <strong className="font-semibold text-navy-900">+5 no score</strong>. Use o
          formato <span className="font-mono">Cidade, UF</span>.
        </p>

        <TagInput
          id="region-draft"
          placeholder="Ex: São Paulo, SP"
          value={regionDraft}
          onChange={setRegionDraft}
          onAdd={() => addTag(regionDraft, setRegionDraft, regions, setRegions)}
        />

        <TagList
          items={regions}
          onRemove={(value) => {
            setRegions(regions.filter((item) => item !== value));
            setSaved(false);
          }}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Canal preferido</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={chip(channel === option)}
                onClick={() => {
                  setChannel(channel === option ? '' : option);
                  setSaved(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Meta de clientes por mês</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {GOAL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={chip(goal === option)}
                onClick={() => {
                  setGoal(goal === option ? '' : option);
                  setSaved(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : saved ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : null}
          {saved ? 'Preferências salvas' : 'Salvar preferências'}
        </button>

        {error ? (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        ) : null}

        {recalculated !== null ? (
          <span className="text-xs text-success">
            {recalculated} leads recalculados.
          </span>
        ) : null}
      </div>

      {/* O recálculo é oferecido, não automático: a base pode ter milhares de
          leads e a reordenação muda a prioridade que a pessoa está usando. */}
      {scoreStale ? (
        <div className="pa-card border-warning/40 p-4">
          <h2 className="text-sm font-semibold text-navy-900">
            Os scores atuais usam as preferências antigas
          </h2>
          <p className="mt-1 text-xs text-muted">
            Nichos ou regiões mudaram. Os leads já cadastrados continuam com a
            pontuação anterior até você recalcular — o que reordena a lista de
            prioridade.
          </p>
          <button
            type="button"
            onClick={() => void recalculate()}
            disabled={recalculating}
            className="mt-3 inline-flex items-center gap-2 rounded-control bg-navy-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {recalculating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {recalculating ? 'Recalculando…' : 'Recalcular score de toda a base'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TagInput({
  id,
  placeholder,
  value,
  onChange,
  onAdd,
}: {
  id: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      onAdd();
    }
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 rounded-control border border-line bg-surface px-3 py-2 text-xs text-navy-900 placeholder:text-muted"
      />
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Adicionar
      </button>
    </div>
  );
}

function TagList({
  items,
  onRemove,
}: {
  items: string[];
  onRemove: (value: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item}>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-soft px-3 py-1.5 text-xs text-navy-900">
            {item}
            <button
              type="button"
              onClick={() => onRemove(item)}
              aria-label={`Remover ${item}`}
              className="rounded-full text-muted hover:text-danger"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
