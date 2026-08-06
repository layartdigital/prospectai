'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';

const CHANNELS = [
  ['WHATSAPP', 'WhatsApp'],
  ['PHONE', 'Ligação'],
  ['EMAIL', 'E-mail'],
  ['INSTAGRAM', 'Instagram'],
  ['IN_PERSON', 'Presencial'],
  ['OTHER', 'Outro'],
] as const;

/**
 * Registro de contato.
 *
 * Registrar atualiza `lastContactedAt` do lead, que alimenta o card de
 * acompanhamento e um dos componentes do score — por isso a ação vive aqui e
 * nao numa tela separada de atividades: o custo de registrar precisa ser
 * menor que o de nao registrar, senao a timeline nasce mentindo.
 */
export function LeadContactForm({ leadId }: { leadId: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<string>('WHATSAPP');
  const [direction, setDirection] = useState<'SENT' | 'RECEIVED'>('SENT');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await clientApi(`/leads/${leadId}/contact-records`, {
        method: 'POST',
        body: JSON.stringify({
          channel,
          direction,
          outcome: outcome.trim() || undefined,
        }),
      });

      setOutcome('');
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível registrar.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="border-b border-line px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Registrar contato
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 border-b border-line bg-surface-soft/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-channel" className="pa-label mb-1.5 block">
            Canal
          </label>
          <select
            id="contact-channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900"
          >
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="contact-direction" className="pa-label mb-1.5 block">
            Direção
          </label>
          <select
            id="contact-direction"
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value === 'RECEIVED' ? 'RECEIVED' : 'SENT')
            }
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900"
          >
            <option value="SENT">Enviado por mim</option>
            <option value="RECEIVED">Recebido do lead</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="contact-outcome" className="pa-label mb-1.5 block">
          Resultado
        </label>
        <input
          id="contact-outcome"
          type="text"
          maxLength={200}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Pediu proposta, sem resposta, remarcou…"
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control px-3 py-1.5 text-xs font-medium text-muted hover:text-navy-900"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          Registrar
        </button>
      </div>
    </form>
  );
}
