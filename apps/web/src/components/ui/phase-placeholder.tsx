import type { LucideIcon } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';

interface PhasePlaceholderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  phase: string;
  delivers: string[];
}

/**
 * Placeholder honesto de rota planejada.
 *
 * Diz o que vem, em qual fase. Nao e paywall e nao abre modal:
 * a regra do projeto e que nenhum modal de bloqueio abre sozinho ao
 * carregar uma pagina.
 */
export function PhasePlaceholder({
  title,
  subtitle,
  icon: Icon,
  phase,
  delivers,
}: PhasePlaceholderProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />

      <section className="pa-card mx-auto max-w-xl px-6 py-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>

        <p className="mt-4 inline-block rounded-full bg-surface-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {phase}
        </p>

        <h2 className="mt-3 text-base font-semibold text-navy-900">
          Esta tela entra na {phase}
        </h2>

        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          A fundação já está no lugar. O que falta é a camada de dados desta área.
        </p>

        <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left">
          {delivers.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-navy-900">
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
