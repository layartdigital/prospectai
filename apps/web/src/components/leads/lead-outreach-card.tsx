'use client';

import {
  CHANNEL_LABELS,
  OUTREACH_CHANNELS,
  OUTREACH_TONES,
  TONE_LABELS,
  type OutreachChannel,
  type OutreachMessageView,
  type OutreachQuotaView,
  type OutreachTone,
} from '@propectai/types';
import {
  Check,
  Copy,
  Lock,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';
import { formatDateTime } from '@/lib/utils';

interface Props {
  leadId: string;
  quota: OutreachQuotaView;
  history: OutreachMessageView[];
}

export function LeadOutreachCard({ leadId, quota, history }: Props) {
  const router = useRouter();

  const [channel, setChannel] = useState<OutreachChannel>('WHATSAPP');
  const [tone, setTone] = useState<OutreachTone>('CONSULTIVO');
  const [objective, setObjective] = useState('');
  const [callToAction, setCallToAction] = useState('');
  const [extraNotes, setExtraNotes] = useState('');

  const [current, setCurrent] = useState<OutreachMessageView | null>(history[0] ?? null);
  const [draft, setDraft] = useState(history[0]?.content ?? '');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const dirty = current !== null && draft !== current.content;

  async function generate(): Promise<void> {
    if (generating) return;

    setGenerating(true);
    setError(null);
    setBlocked(false);

    try {
      const message = await clientApi<OutreachMessageView>(
        `/ai/outreach/lead/${leadId}/generate`,
        {
          method: 'POST',
          body: JSON.stringify({
            channel,
            tone,
            objective: objective.trim() || undefined,
            callToAction: callToAction.trim() || undefined,
            extraNotes: extraNotes.trim() || undefined,
          }),
        },
      );

      setCurrent(message);
      setDraft(message.content);
      router.refresh();
    } catch (caught) {
      // O bloqueio de plano só aparece AQUI, depois do clique.
      // Carregar a ficha nunca dispara paywall.
      if (caught instanceof ClientApiError && caught.code === 'PLAN_LIMIT') {
        setBlocked(true);
        setError(caught.message);
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar');
    } finally {
      setGenerating(false);
    }
  }

  async function save(): Promise<void> {
    if (!current || !dirty) return;

    const updated = await clientApi<OutreachMessageView>(`/ai/outreach/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: draft }),
    });
    setCurrent(updated);
    router.refresh();
  }

  async function markSent(): Promise<void> {
    if (!current) return;

    const updated = await clientApi<OutreachMessageView>(
      `/ai/outreach/${current.id}/mark-sent`,
      { method: 'POST' },
    );
    setCurrent(updated);
    router.refresh();
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const select =
    'w-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900';
  const action =
    'inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="pa-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-card-title text-navy-900">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
          IA de abordagem
        </h2>
        <span className="text-[11px] text-muted">
          {quota.enabled
            ? `${quota.available} de ${quota.included} gerações restantes`
            : `Indisponível no plano ${quota.planCode}`}
        </span>
      </div>

      <div className="p-4">
        <p className="mb-3 text-xs text-muted">
          A mensagem é montada a partir dos dados verificados deste lead e do
          motivo mais forte do score. Nada é inventado, e nada é enviado
          automaticamente — você lê, ajusta e envia.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="channel" className="pa-label mb-1 block">
              Canal
            </label>
            <select
              id="channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as OutreachChannel)}
              className={select}
            >
              {OUTREACH_CHANNELS.map((item) => (
                <option key={item} value={item}>
                  {CHANNEL_LABELS[item]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tone" className="pa-label mb-1 block">
              Tom
            </label>
            <select
              id="tone"
              value={tone}
              onChange={(event) => setTone(event.target.value as OutreachTone)}
              className={select}
            >
              {OUTREACH_TONES.map((item) => (
                <option key={item} value={item}>
                  {TONE_LABELS[item]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="objective" className="pa-label mb-1 block">
              Objetivo <span className="normal-case text-muted">(opcional)</span>
            </label>
            <input
              id="objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Ex: agendar uma conversa de 15 minutos"
              className={select}
            />
          </div>

          <div>
            <label htmlFor="cta" className="pa-label mb-1 block">
              Chamada final <span className="normal-case text-muted">(opcional)</span>
            </label>
            <input
              id="cta"
              value={callToAction}
              onChange={(event) => setCallToAction(event.target.value)}
              placeholder="Ex: posso te mandar dois exemplos?"
              className={select}
            />
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="notes" className="pa-label mb-1 block">
            Observações <span className="normal-case text-muted">(opcional)</span>
          </label>
          <input
            id="notes"
            value={extraNotes}
            onChange={(event) => setExtraNotes(event.target.value)}
            placeholder="Algo específico que você queira mencionar"
            className={select}
          />
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="mt-4 inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          )}
          {generating ? 'Gerando…' : current ? 'Regenerar' : 'Gerar abordagem'}
        </button>

        {/* Bloqueio contextualizado, no lugar do resultado — não em modal
            sobre a tela inteira. */}
        {blocked ? (
          <div className="mt-4 rounded-card border border-warning/30 bg-warning/5 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-navy-900">
              <Lock className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
              {error}
            </p>
            <Link
              href="/subscription"
              className="mt-2 inline-block rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
            >
              Ver planos
            </Link>
          </div>
        ) : error ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        ) : null}

        {current ? (
          <div className="mt-4">
            <label htmlFor="draft" className="pa-label mb-1.5 block">
              Mensagem gerada · versão {current.version}
            </label>
            <textarea
              id="draft"
              rows={9}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-navy-900"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className={action}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? 'Copiado' : 'Copiar'}
              </button>

              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty}
                className={action}
              >
                Salvar edição
              </button>

              <button
                type="button"
                onClick={() => void markSent()}
                disabled={current.isSent}
                className={action}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {current.isSent ? 'Registrada como enviada' : 'Registrar como enviada'}
              </button>

              {dirty ? (
                <span className="text-[11px] text-muted">Alterações não salvas</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {history.length > 1 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted">
              Histórico de versões ({history.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrent(item);
                      setDraft(item.content);
                    }}
                    className="w-full rounded-control px-2 py-1.5 text-left text-[11px] text-muted hover:bg-surface-soft hover:text-navy-900"
                  >
                    Versão {item.version} · {CHANNEL_LABELS[item.channel]} ·{' '}
                    {TONE_LABELS[item.tone]} · {formatDateTime(item.createdAt)}
                    {item.isSent ? ' · enviada' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
