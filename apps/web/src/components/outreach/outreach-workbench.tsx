'use client';

import {
  CHANNEL_LABELS,
  OUTREACH_CHANNELS,
  OUTREACH_TONES,
  TONE_LABELS,
  type LeadListItem,
  type OutreachChannel,
  type OutreachMessageView,
  type OutreachQuotaView,
  type OutreachTone,
} from '@propectai/types';
import { Check, Copy, Loader2, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ScoreBadge, WebsiteBadge } from '@/components/leads/badges';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface Generated {
  leadId: string;
  leadName: string;
  message: OutreachMessageView | null;
  error: string | null;
}

export function OutreachWorkbench({
  leads,
  quota,
}: {
  leads: LeadListItem[];
  quota: OutreachQuotaView;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState<OutreachChannel>('WHATSAPP');
  const [tone, setTone] = useState<OutreachTone>('CONSULTIVO');
  const [objective, setObjective] = useState('');

  const [results, setResults] = useState<Generated[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => lead.name.toLowerCase().includes(term));
  }, [leads, search]);

  const overQuota = selected.length > quota.available;

  function toggle(leadId: string): void {
    setSelected((current) =>
      current.includes(leadId)
        ? current.filter((id) => id !== leadId)
        : [...current, leadId],
    );
  }

  /**
   * Geração sequencial, não paralela.
   *
   * Cada geração consome cota e grava no banco. Disparar vinte de uma vez
   * dificultaria parar no meio e poderia estourar o limite antes de a
   * primeira resposta chegar.
   */
  async function generateBatch(): Promise<void> {
    if (running || selected.length === 0) return;

    setRunning(true);
    setResults([]);
    setProgress(0);
    setBlocked(null);

    const collected: Generated[] = [];

    for (const [index, leadId] of selected.entries()) {
      const lead = leads.find((item) => item.id === leadId);
      if (!lead) continue;

      try {
        const message = await clientApi<OutreachMessageView>(
          `/ai/outreach/lead/${leadId}/generate`,
          {
            method: 'POST',
            body: JSON.stringify({
              channel,
              tone,
              objective: objective.trim() || undefined,
            }),
          },
        );

        collected.push({ leadId, leadName: lead.name, message, error: null });
      } catch (caught) {
        // Limite de plano interrompe o lote: continuar geraria uma sequência
        // de erros idênticos sem produzir nada.
        if (caught instanceof ClientApiError && caught.code === 'PLAN_LIMIT') {
          setBlocked(caught.message);
          setResults([...collected]);
          setRunning(false);
          return;
        }

        collected.push({
          leadId,
          leadName: lead.name,
          message: null,
          error: caught instanceof Error ? caught.message : 'Falha na geração',
        });
      }

      setResults([...collected]);
      setProgress(Math.round(((index + 1) / selected.length) * 100));
    }

    setRunning(false);
  }

  async function copy(id: string, content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const select =
    'w-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900';

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      {/* ---- Seleção de leads ------------------------------------------- */}
      <section className="pa-card flex max-h-[70vh] flex-col">
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filtrar leads…"
              aria-label="Filtrar leads"
              className="w-full rounded-control border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-navy-900"
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
            <span>
              {selected.length} de {filtered.length} selecionados
            </span>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  selected.length === filtered.length
                    ? []
                    : filtered.map((lead) => lead.id),
                )
              }
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              {selected.length === filtered.length ? 'Limpar' : 'Selecionar todos'}
            </button>
          </div>
        </div>

        <ul className="flex-1 divide-y divide-line overflow-y-auto">
          {filtered.map((lead) => (
            <li key={lead.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors',
                  selected.includes(lead.id)
                    ? 'bg-brand-50'
                    : 'hover:bg-surface-soft/60',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(lead.id)}
                  onChange={() => toggle(lead.id)}
                  className="mt-0.5 accent-brand-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-navy-900">
                    {lead.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <ScoreBadge value={lead.score} level={lead.scoreLevel} />
                    <WebsiteBadge status={lead.websiteStatus} />
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Configuração e resultados ---------------------------------- */}
      <div className="space-y-4">
        <section className="pa-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-card-title text-navy-900">
              <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
              Configuração da abordagem
            </h2>
            <span className="text-[11px] text-muted">
              {quota.enabled
                ? `${quota.available} gerações restantes`
                : `Indisponível no plano ${quota.planCode}`}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="wb-channel" className="pa-label mb-1 block">
                Canal
              </label>
              <select
                id="wb-channel"
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
              <label htmlFor="wb-tone" className="pa-label mb-1 block">
                Tom
              </label>
              <select
                id="wb-tone"
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
              <label htmlFor="wb-objective" className="pa-label mb-1 block">
                Objetivo
              </label>
              <input
                id="wb-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Opcional"
                className={select}
              />
            </div>
          </div>

          {overQuota ? (
            <p className="mt-3 rounded-control bg-warning/10 px-3 py-2 text-xs text-warning">
              Você selecionou {selected.length} leads e tem {quota.available}{' '}
              gerações disponíveis. O lote vai parar quando o limite chegar.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void generateBatch()}
            disabled={running || selected.length === 0}
            className="mt-4 inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {running
              ? `Gerando… ${progress}%`
              : `Gerar ${selected.length || ''} ${selected.length === 1 ? 'abordagem' : 'abordagens'}`.trim()}
          </button>

          {running ? (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}

          {blocked ? (
            <div className="mt-3 rounded-card border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs font-semibold text-navy-900">{blocked}</p>
              <p className="mt-1 text-xs text-muted">
                O lote parou aqui. As abordagens já geradas estão abaixo.
              </p>
              <Link
                href="/subscription"
                className="mt-2 inline-block rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
              >
                Ver planos
              </Link>
            </div>
          ) : null}
        </section>

        {results.map((result) => (
          <section key={result.leadId} className="pa-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <Link
                href={`/leads/${result.leadId}`}
                className="text-[13px] font-semibold text-navy-900 hover:text-brand-600"
              >
                {result.leadName}
              </Link>

              {result.message ? (
                <button
                  type="button"
                  onClick={() => void copy(result.leadId, result.message!.content)}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
                >
                  {copiedId === result.leadId ? (
                    <Check className="h-3 w-3 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  {copiedId === result.leadId ? 'Copiado' : 'Copiar'}
                </button>
              ) : null}
            </div>

            {result.message ? (
              <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-navy-900">
                {result.message.content}
              </pre>
            ) : (
              <p className="px-4 py-3 text-xs text-danger">{result.error}</p>
            )}
          </section>
        ))}

        {results.length > 0 && !running ? (
          <p className="rounded-card border border-dashed border-line px-4 py-3 text-xs text-muted">
            Abra a ficha de cada lead para editar o texto e registrar o envio.
            Nenhuma mensagem foi enviada — o disparo é sempre seu.
          </p>
        ) : null}
      </div>
    </div>
  );
}
