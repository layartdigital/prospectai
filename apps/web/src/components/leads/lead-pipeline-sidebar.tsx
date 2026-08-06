'use client';

import type { PipelineStageView } from '@propectai/types';
import { Check, Circle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

export function LeadPipelineSidebar({
  leadId,
  stages,
  currentSlug,
}: {
  leadId: string;
  stages: PipelineStageView[];
  currentSlug: string | null;
}) {
  const router = useRouter();
  // Atualização otimista: a etapa muda na hora e volta atrás em caso de erro.
  const [selected, setSelected] = useState(currentSlug);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStage(slug: string): Promise<void> {
    if (pending || slug === selected) return;

    const previous = selected;
    setSelected(slug);
    setPending(slug);
    setError(null);

    try {
      await clientApi(`/leads/${leadId}/pipeline-stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stageSlug: slug }),
      });
      router.refresh();
    } catch (caught) {
      setSelected(previous);
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível mudar a etapa',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="pa-card">
      <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
        Pipeline
      </h2>

      <ul className="space-y-0.5 p-2">
        {stages.map((stage) => {
          const active = stage.slug === selected;
          const loading = pending === stage.slug;

          return (
            <li key={stage.id}>
              <button
                type="button"
                onClick={() => void changeStage(stage.slug)}
                disabled={pending !== null}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-[13px] font-medium transition-colors disabled:cursor-wait',
                  active
                    ? 'bg-brand-600 text-white'
                    : 'text-muted hover:bg-surface-soft hover:text-navy-900',
                )}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                ) : active ? (
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Circle
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: stage.color }}
                    aria-hidden="true"
                  />
                )}
                {stage.name}
              </button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
