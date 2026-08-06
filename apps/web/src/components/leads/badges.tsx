import type { SignalState, WebsiteStatus, WhatsAppStatus } from '@propectai/types';

import { cn } from '@/lib/utils';

const LEVEL_STYLES: Record<string, string> = {
  BAIXA: 'bg-surface-soft text-muted',
  MEDIA: 'bg-warning/10 text-warning',
  ALTA: 'bg-brand-600/10 text-brand-600',
  MUITO_ALTA: 'bg-brand-600 text-white',
};

const LEVEL_LABELS: Record<string, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  MUITO_ALTA: 'Muito alta',
};

export function ScoreBadge({
  value,
  level,
  className,
}: {
  value: number;
  level: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        LEVEL_STYLES[level] ?? LEVEL_STYLES.BAIXA,
        className,
      )}
    >
      {LEVEL_LABELS[level] ?? level}
      <span className="opacity-70">{value}</span>
    </span>
  );
}

const WEBSITE_LABELS: Record<WebsiteStatus, string> = {
  SEM_SITE: 'Sem site',
  SITE_PRECARIO: 'Site precário',
  SITE_PROPRIO: 'Site próprio',
  DESCONHECIDO: 'Site não verificado',
};

/**
 * Site precário ganha cor de oportunidade, não de problema: é um dos
 * melhores prospects que existem, não um lead descartável.
 */
const WEBSITE_STYLES: Record<WebsiteStatus, string> = {
  SEM_SITE: 'bg-success/10 text-success',
  SITE_PRECARIO: 'bg-brand-600/10 text-brand-600',
  SITE_PROPRIO: 'bg-surface-soft text-muted',
  DESCONHECIDO: 'bg-surface-soft text-muted',
};

export function WebsiteBadge({ status }: { status: WebsiteStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        WEBSITE_STYLES[status],
      )}
    >
      {WEBSITE_LABELS[status]}
    </span>
  );
}

/**
 * Sinal em três estados.
 *
 * DESCONHECIDO aparece em cinza neutro e com rótulo honesto — "não
 * verificado". Nunca em vermelho ao lado de sinais realmente ausentes:
 * o sistema não olhou, e dizer o contrário é falso negativo.
 */
export function SignalBadge({
  state,
  labelPresent,
  labelAbsent,
  labelUnknown,
}: {
  state: SignalState;
  labelPresent: string;
  labelAbsent: string;
  labelUnknown: string;
}) {
  if (state === 'PRESENTE') {
    return <span className="pa-signal-present">{labelPresent}</span>;
  }
  if (state === 'AUSENTE') {
    return <span className="pa-signal-absent">{labelAbsent}</span>;
  }
  return <span className="pa-signal-unknown">{labelUnknown}</span>;
}

export function WhatsAppBadge({ status }: { status: WhatsAppStatus }) {
  if (status === 'VERIFIED') {
    return <span className="pa-signal-present">WhatsApp confirmado</span>;
  }
  if (status === 'LIKELY') {
    // "Provável" e não "Com WhatsApp": houve inferência pelo formato do
    // número, não verificação.
    return (
      <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
        WhatsApp provável
      </span>
    );
  }
  return <span className="pa-signal-unknown">WhatsApp não verificado</span>;
}
