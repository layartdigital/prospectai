import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  /** Card azul de destaque, usado em "Oportunidades altas". */
  highlight?: boolean;
  loading?: boolean;
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight = false,
  loading = false,
}: KpiCardProps) {
  return (
    <div
      // data-* em vez de classe como âncora de teste.
      //
      // O E2E localizava o card por `div.pa-card` e o número por `p.text-kpi`.
      // Classe de estilo é contrato acidental: `cn()` passa por tailwind-merge,
      // que pode descartar `text-kpi` por conflito de grupo com `text-navy-900`
      // — e aí o seletor deixa de existir sem ninguém mudar o componente.
      //
      // O rótulo vai junto para o teste filtrar sem depender do texto renderizado,
      // que aparece em maiúsculas por CSS mas vive em minúsculas no DOM.
      data-testid="kpi-card"
      data-kpi-label={label}
      className={cn(
        'pa-card flex flex-col justify-between p-4 transition-shadow hover:shadow-card-hover',
        highlight && 'border-brand-600 bg-brand-600 text-white',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'pa-label',
            highlight && 'text-white/80',
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            highlight ? 'bg-white/15 text-white' : 'bg-surface-soft text-muted',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>

      {loading ? (
        <div className="pa-skeleton mt-3 h-9 w-20" />
      ) : (
        <p
          data-testid="kpi-value"
          className={cn('mt-3 text-kpi', highlight ? 'text-white' : 'text-navy-900')}
        >
          {value}
        </p>
      )}

      {hint ? (
        <p className={cn('mt-1 text-xs', highlight ? 'text-white/75' : 'text-muted')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
