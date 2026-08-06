'use client';

import {
  COMPLEXITY_HINTS,
  COMPLEXITY_LABELS,
  COMPLEXITY_LEVELS,
  DEFAULT_EXTRAS,
  SERVICE_TYPES,
  URGENCY_HINTS,
  URGENCY_LABELS,
  URGENCY_LEVELS,
  calculatePricing,
  formatBRL,
  type ComplexityLevel,
  type UrgencyLevel,
} from '@propectai/types';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

const HOURLY_PRESETS = [50, 80, 100, 150, 200];

export function PricingCalculator() {
  const [serviceType, setServiceType] = useState<string>(SERVICE_TYPES[0]);
  const [hourlyRate, setHourlyRate] = useState(100);
  const [hours, setHours] = useState(20);
  const [complexity, setComplexity] = useState<ComplexityLevel>('BAIXA');
  const [urgency, setUrgency] = useState<UrgencyLevel>('NORMAL');
  const [extras, setExtras] = useState<string[]>([]);
  const [margin, setMargin] = useState(0);

  const extrasCents = useMemo(
    () =>
      DEFAULT_EXTRAS.filter((extra) => extras.includes(extra.key)).reduce(
        (sum, extra) => sum + extra.priceCents,
        0,
      ),
    [extras],
  );

  // Recalcula a cada tecla. O cálculo é puro e barato — não há motivo para
  // exigir que o usuário clique em "calcular" para ver o efeito do que mudou.
  const result = useMemo(
    () =>
      calculatePricing({
        hourlyRateCents: hourlyRate * 100,
        estimatedHours: hours,
        complexity,
        urgency,
        extrasCents,
        marginPercent: margin,
      }),
    [hourlyRate, hours, complexity, urgency, extrasCents, margin],
  );

  const field =
    'w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900';

  const option = (active: boolean) =>
    cn(
      'rounded-control border px-3 py-2.5 text-left transition-colors',
      active
        ? 'border-brand-600 bg-brand-50'
        : 'border-line bg-surface hover:border-muted',
    );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Tipo de serviço</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SERVICE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setServiceType(type)}
                className={cn(option(serviceType === type), 'text-xs font-medium text-navy-900')}
              >
                {type}
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="pa-card p-4">
            <label htmlFor="rate" className="text-card-title text-navy-900">
              Valor hora
            </label>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-muted">R$</span>
              <input
                id="rate"
                type="number"
                min={1}
                value={hourlyRate}
                onChange={(event) => setHourlyRate(Number(event.target.value) || 0)}
                className={field}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HOURLY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setHourlyRate(preset)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    hourlyRate === preset
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line text-muted hover:text-navy-900',
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </section>

          <section className="pa-card p-4">
            <label htmlFor="hours" className="text-card-title text-navy-900">
              Horas previstas
            </label>
            <input
              id="hours"
              type="number"
              min={1}
              max={2000}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value) || 0)}
              className={cn(field, 'mt-3')}
            />
            <input
              type="range"
              min={1}
              max={200}
              value={Math.min(hours, 200)}
              onChange={(event) => setHours(Number(event.target.value))}
              aria-label="Horas previstas"
              className="mt-3 w-full accent-brand-600"
            />
          </section>
        </div>

        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Complexidade</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {COMPLEXITY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setComplexity(level)}
                className={option(complexity === level)}
              >
                <span className="block text-xs font-semibold text-navy-900">
                  {COMPLEXITY_LABELS[level]}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {COMPLEXITY_HINTS[level]}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Urgência</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {URGENCY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setUrgency(level)}
                className={option(urgency === level)}
              >
                <span className="block text-xs font-semibold text-navy-900">
                  {URGENCY_LABELS[level]}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {URGENCY_HINTS[level]}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Extras</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DEFAULT_EXTRAS.map((extra) => {
              const checked = extras.includes(extra.key);
              return (
                <label
                  key={extra.key}
                  className={cn(
                    option(checked),
                    'flex cursor-pointer items-center justify-between gap-2',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs text-navy-900">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setExtras((current) =>
                          checked
                            ? current.filter((key) => key !== extra.key)
                            : [...current, extra.key],
                        )
                      }
                      className="accent-brand-600"
                    />
                    {extra.label}
                  </span>
                  <span className="text-xs font-medium text-muted">
                    {formatBRL(extra.priceCents)}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="pa-card p-4">
          <label htmlFor="margin" className="text-card-title text-navy-900">
            Margem — {margin}%
          </label>
          <input
            id="margin"
            type="range"
            min={0}
            max={100}
            step={5}
            value={margin}
            onChange={(event) => setMargin(Number(event.target.value))}
            className="mt-3 w-full accent-brand-600"
          />
          <p className="mt-2 text-[11px] text-muted">
            Margem cobre imprevisto, retrabalho e o tempo que você não fatura —
            reunião, revisão, suporte pós-entrega.
          </p>
        </section>
      </div>

      {/* Resultado grudado: o número precisa estar visível enquanto os
          controles são mexidos, senão o usuário perde a relação de causa. */}
      <div className="space-y-4 xl:sticky xl:top-[76px] xl:self-start">
        <section className="rounded-card bg-navy-900 p-5 text-white">
          <p className="text-[11px] uppercase tracking-wide text-white/60">
            Resultado
          </p>
          <p className="mt-1 text-sm font-medium text-white/90">{serviceType}</p>

          <p className="mt-4 text-3xl font-bold">{formatBRL(result.finalCents)}</p>
          <p className="mt-1 text-xs text-white/70">
            {formatBRL(result.effectiveHourlyCents)} por hora efetiva
          </p>

          <dl className="mt-4 space-y-1.5 border-t border-white/15 pt-3 text-xs">
            <Line label={`Base · ${hours}h`} value={formatBRL(result.baseCents)} />
            {result.complexityCents > 0 ? (
              <Line
                label="Complexidade"
                value={`+ ${formatBRL(result.complexityCents)}`}
              />
            ) : null}
            {result.urgencyCents > 0 ? (
              <Line label="Urgência" value={`+ ${formatBRL(result.urgencyCents)}`} />
            ) : null}
            {result.extrasCents > 0 ? (
              <Line label="Extras" value={`+ ${formatBRL(result.extrasCents)}`} />
            ) : null}
            {result.marginCents > 0 ? (
              <Line label={`Margem ${margin}%`} value={`+ ${formatBRL(result.marginCents)}`} />
            ) : null}
          </dl>
        </section>

        <section className="pa-card p-4">
          <h2 className="text-card-title text-navy-900">Faixa de negociação</h2>
          <dl className="mt-3 space-y-3 text-xs">
            <Range
              label="Mínimo"
              hint="abaixo disto a margem some"
              value={formatBRL(result.minimumCents)}
              tone="text-danger"
            />
            <Range
              label="Ideal"
              hint="valor que você deve pedir"
              value={formatBRL(result.idealCents)}
              tone="text-brand-600"
            />
            <Range
              label="Premium"
              hint="escopo ampliado ou prazo apertado"
              value={formatBRL(result.premiumCents)}
              tone="text-success"
            />
          </dl>
        </section>

        <p className="rounded-card border border-dashed border-line px-4 py-3 text-[11px] text-muted">
          Os valores ficam nesta tela. Gerar proposta a partir deste cálculo
          entra junto com o módulo de Propostas.
        </p>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-white/60">{label}</dt>
      <dd className="font-medium text-white/90">{value}</dd>
    </div>
  );
}

function Range({
  label,
  hint,
  value,
  tone,
}: {
  label: string;
  hint: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <dt className={cn('font-semibold', tone)}>{label}</dt>
        <p className="text-[11px] text-muted">{hint}</p>
      </div>
      <dd className="shrink-0 font-mono text-sm font-semibold text-navy-900">
        {value}
      </dd>
    </div>
  );
}
