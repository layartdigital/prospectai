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
        <p className={cn('mt-3 text-kpi', highlight ? 'text-white' : 'text-navy-900')}>
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
