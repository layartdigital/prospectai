'use client';

import {
  CHANNEL_OPTIONS,
  GOAL_OPTIONS,
  SERVICE_OPTIONS,
  type PreferencesView,
} from '@propectai/types';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';

/**
 * Onboarding de 5 etapas.
 *
 * Persiste a cada avanço, nao so no fim: quem fecha a aba na etapa 3 volta na
 * etapa 3 com o que ja respondeu. Onboarding que perde resposta e onboarding
 * que a pessoa abandona na segunda tentativa.
 *
 * Nenhuma etapa e obrigatoria. Nicho e regiao alimentam dois pesos do score
 * (+15 e +5), entao a tela explica o efeito em vez de exigir preenchimento —
 * a pessoa decide informada, e nao empurrada.
 */

const STEPS = [
  { key: 'services', title: 'O que você vende' },
  { key: 'niches', title: 'Nichos que você atende' },
  { key: 'regions', title: 'Onde você atua' },
  { key: 'channel', title: 'Como você aborda' },
  { key: 'goal', title: 'Sua meta mensal' },
] as const;

interface Props {
  initial: PreferencesView;
}

export function OnboardingWizard({ initial }: Props) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [servicesSold, setServicesSold] = useState<string[]>(initial.servicesSold);
  const [targetNiches, setTargetNiches] = useState<string[]>(initial.targetNiches);
  const [targetRegions, setTargetRegions] = useState<string[]>(initial.targetRegions);
  const [preferredChannel, setPreferredChannel] = useState(initial.preferredChannel ?? '');
  const [monthlyGoal, setMonthlyGoal] = useState(initial.monthlyGoal ?? '');
  const [nicheDraft, setNicheDraft] = useState('');
  const [regionDraft, setRegionDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLast = step === STEPS.length - 1;

  // STEPS e tupla `as const`, entao STEPS[0] tem tipo conhecido — indexar por
  // `number` nao tem, sob noUncheckedIndexedAccess. O fallback e ancora de
  // tipo, nao tratamento de erro: `step` nunca sai da faixa.
  const currentStep = STEPS[step] ?? STEPS[0];

  function toggle(list: string[], value: string, set: (next: string[]) => void): void {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function addTag(
    draft: string,
    list: string[],
    set: (next: string[]) => void,
    clear: () => void,
  ): void {
    const value = draft.trim();
    if (!value || list.includes(value)) {
      clear();
      return;
    }
    set([...list, value]);
    clear();
  }

  async function persist(): Promise<void> {
    await clientApi('/settings/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        servicesSold,
        targetNiches,
        targetRegions,
        preferredChannel: preferredChannel || undefined,
        monthlyGoal: monthlyGoal || undefined,
      }),
    });
  }

  async function handleNext(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await persist();

      if (isLast) {
        await clientApi('/settings/onboarding/complete', { method: 'POST' });
        router.push('/search');
        router.refresh();
        return;
      }

      setStep((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível salvar. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pa-card p-6">
      {/* ---- Progresso ------------------------------------------------- */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <p className="pa-label">
            Etapa {step + 1} de {STEPS.length}
          </p>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await persist();
                } catch {
                  // Pular nao pode falhar por causa da gravacao: o que a pessoa
                  // ja respondeu sera salvo na proxima interacao.
                } finally {
                  setBusy(false);
                  router.push('/dashboard');
                }
              })();
            }}
            className="rounded text-[11px] text-muted underline underline-offset-2 hover:text-navy-900"
          >
            Pular por enquanto
          </button>
        </div>

        <div
          className="mt-2 flex gap-1"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
          aria-label="Progresso do onboarding"
        >
          {STEPS.map((item, index) => (
            <span
              key={item.key}
              className={`h-1 flex-1 rounded-full ${
                index <= step ? 'bg-brand-600' : 'bg-surface-soft'
              }`}
            />
          ))}
        </div>
      </div>

      <h1 className="text-lg font-semibold text-navy-900">{currentStep.title}</h1>

      {/* ---- Etapas ------------------------------------------------------ */}
      <div className="mt-4 min-h-[170px]">
        {step === 0 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Usamos isso para escrever abordagens que falam do seu serviço, não de
              um serviço genérico.
            </p>
            <ChipGroup
              options={[...SERVICE_OPTIONS]}
              selected={servicesSold}
              onToggle={(value) => toggle(servicesSold, value, setServicesSold)}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Lead de um nicho prioritário ganha <strong>+15 pontos</strong> no score.
              Deixar em branco não penaliza ninguém — só não prioriza.
            </p>
            <TagInput
              label="Adicionar nicho"
              placeholder="Restaurantes, clínicas, academias…"
              draft={nicheDraft}
              onDraft={setNicheDraft}
              tags={targetNiches}
              onAdd={() =>
                addTag(nicheDraft, targetNiches, setTargetNiches, () => setNicheDraft(''))
              }
              onRemove={(value) =>
                setTargetNiches(targetNiches.filter((item) => item !== value))
              }
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Lead em região atendida ganha <strong>+5 pontos</strong>. Cidade, estado
              ou bairro — como você pensa a sua área.
            </p>
            <TagInput
              label="Adicionar região"
              placeholder="São Paulo, Zona Sul, ABC…"
              draft={regionDraft}
              onDraft={setRegionDraft}
              tags={targetRegions}
              onAdd={() =>
                addTag(regionDraft, targetRegions, setTargetRegions, () =>
                  setRegionDraft(''),
                )
              }
              onRemove={(value) =>
                setTargetRegions(targetRegions.filter((item) => item !== value))
              }
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              O canal preferido define o tom padrão das abordagens geradas.
            </p>
            <ChipGroup
              options={[...CHANNEL_OPTIONS]}
              selected={preferredChannel ? [preferredChannel] : []}
              onToggle={(value) =>
                setPreferredChannel(preferredChannel === value ? '' : value)
              }
            />
          </>
        ) : null}

        {step === 4 ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Quantos clientes novos por mês você quer fechar? Serve para o
              dashboard mostrar progresso, não para cobrança.
            </p>
            <ChipGroup
              options={[...GOAL_OPTIONS]}
              selected={monthlyGoal ? [monthlyGoal] : []}
              onToggle={(value) => setMonthlyGoal(monthlyGoal === value ? '' : value)}
            />
          </>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      {/* ---- Navegação --------------------------------------------------- */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0 || busy}
          className="flex items-center gap-1.5 rounded-control px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-navy-900 disabled:invisible"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Voltar
        </button>

        <button
          type="button"
          onClick={() => void handleNext()}
          disabled={busy}
          className="flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Salvando…
            </>
          ) : isLast ? (
            <>
              <Check className="h-4 w-4" aria-hidden="true" />
              Concluir
            </>
          ) : (
            <>
              Continuar
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(option)}
            className={`rounded-control border px-3 py-1.5 text-[13px] transition-colors ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-line bg-surface text-navy-900 hover:border-brand-600'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function TagInput({
  label,
  placeholder,
  draft,
  onDraft,
  tags,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  draft: string;
  onDraft: (value: string) => void;
  tags: string[];
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={label} className="sr-only">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={label}
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Enter adiciona a tag; sem isto o formulário submeteria a etapa.
              event.preventDefault();
              onAdd();
            }
          }}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
        />
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 rounded-control border border-line px-3 py-2 text-[13px] font-medium text-navy-900 hover:border-brand-600"
        >
          Adicionar
        </button>
      </div>

      {tags.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remover ${tag}`}
                className="rounded-control border border-line bg-surface-soft px-2.5 py-1 text-xs text-navy-900 hover:border-danger hover:text-danger"
              >
                {tag} ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
