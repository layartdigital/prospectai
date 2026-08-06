'use client';

import { CalendarClock, Check, Clock, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { clientApi } from '@/lib/client-api';
import { formatDateTime } from '@/lib/utils';

interface FollowUpItem {
  id: string;
  channel: string;
  status: string;
  dueAt: string;
  notes: string | null;
}

const CHANNELS = [
  ['WHATSAPP', 'WhatsApp'],
  ['PHONE', 'Ligação'],
  ['EMAIL', 'E-mail'],
  ['INSTAGRAM', 'Instagram'],
  ['IN_PERSON', 'Presencial'],
  ['OTHER', 'Outro'],
] as const;

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-brand-600/10 text-brand-600',
  OVERDUE: 'bg-danger/10 text-danger',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-surface-soft text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  OVERDUE: 'Vencido',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

/** `datetime-local` exige `YYYY-MM-DDTHH:mm` em hora local, não ISO com fuso. */
function toLocalInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function defaultDueAt(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return toLocalInput(tomorrow);
}

export function LeadFollowUps({
  leadId,
  items,
}: {
  leadId: string;
  items: FollowUpItem[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [channel, setChannel] = useState<string>('WHATSAPP');
  const [notes, setNotes] = useState('');
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pa-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-card-title text-navy-900">Follow-ups</h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Agendar
        </button>
      </div>

      {open ? (
        <form
          className="space-y-3 border-b border-line bg-surface-soft/40 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await clientApi(`/leads/${leadId}/follow-ups`, {
                method: 'POST',
                body: JSON.stringify({
                  // O input devolve hora local sem fuso; o `new Date` local
                  // resolve para o instante correto antes de virar ISO.
                  dueAt: new Date(dueAt).toISOString(),
                  channel,
                  notes: notes.trim() || undefined,
                }),
              });
              setOpen(false);
              setNotes('');
              setDueAt(defaultDueAt());
            });
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="followup-due" className="pa-label mb-1.5 block">
                Quando
              </label>
              <input
                id="followup-due"
                type="datetime-local"
                required
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900"
              />
            </div>

            <div>
              <label htmlFor="followup-channel" className="pa-label mb-1.5 block">
                Canal
              </label>
              <select
                id="followup-channel"
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
          </div>

          <div>
            <label htmlFor="followup-notes" className="pa-label mb-1.5 block">
              Observação
            </label>
            <input
              id="followup-notes"
              type="text"
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Retomar proposta, confirmar orçamento…"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
            />
          </div>

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
              Agendar
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="border-b border-line px-4 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nenhum follow-up agendado"
          description="Agende um retorno para não deixar o contato esfriar."
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const finished = item.status === 'COMPLETED' || item.status === 'CANCELLED';

            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-navy-900">
                      {CHANNELS.find(([value]) => value === item.channel)?.[1] ??
                        item.channel}{' '}
                      · {formatDateTime(item.dueAt)}
                    </p>
                    {item.notes ? (
                      <p className="mt-0.5 text-[11px] text-muted">{item.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLES[item.status] ?? STATUS_STYLES.CANCELLED
                      }`}
                    >
                      {STATUS_LABELS[item.status] ?? item.status}
                    </span>

                    {/* Concluído e cancelado ainda podem ser reagendados: é
                        assim que um retorno perdido volta para a agenda. */}
                    {!finished ? (
                      <>
                        <IconAction
                          label="Concluir"
                          icon={Check}
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              clientApi(`/leads/${leadId}/follow-ups/${item.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'COMPLETED' }),
                              }),
                            )
                          }
                        />
                        <IconAction
                          label="Cancelar"
                          icon={X}
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              clientApi(`/leads/${leadId}/follow-ups/${item.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'CANCELLED' }),
                              }),
                            )
                          }
                        />
                      </>
                    ) : null}

                    <IconAction
                      label="Reagendar"
                      icon={CalendarClock}
                      disabled={busy}
                      onClick={() => {
                        setReschedulingId(reschedulingId === item.id ? null : item.id);
                        setRescheduleAt(toLocalInput(new Date(item.dueAt)));
                      }}
                    />
                  </div>
                </div>

                {reschedulingId === item.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      aria-label="Nova data"
                      value={rescheduleAt}
                      onChange={(event) => setRescheduleAt(event.target.value)}
                      className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await clientApi(`/leads/${leadId}/follow-ups/${item.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({
                              dueAt: new Date(rescheduleAt).toISOString(),
                            }),
                          });
                          setReschedulingId(null);
                        })
                      }
                      className="rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      Confirmar
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-control border border-line p-1 text-muted transition-colors hover:border-brand-600 hover:text-navy-900 disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
