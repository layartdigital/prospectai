'use client';

import {
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  formatBRL,
  type LeadListItem,
  type ProposalListResponse,
  type ProposalStatus,
  type ProposalView,
} from '@propectai/types';
import { FileText, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { clientApi } from '@/lib/client-api';
import { cn, formatDateTime, formatInteger } from '@/lib/utils';

const STATUS_STYLES: Record<ProposalStatus, string> = {
  DRAFT: 'bg-surface-soft text-muted',
  SENT: 'bg-info/10 text-info',
  ACCEPTED: 'bg-success/10 text-success',
  REJECTED: 'bg-danger/10 text-danger',
  EXPIRED: 'bg-warning/10 text-warning',
};

interface DraftItem {
  description: string;
  quantity: number;
  unit: number;
}

export function ProposalsBoard({
  initial,
  leads,
}: {
  initial: ProposalListResponse;
  leads: LeadListItem[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [leadId, setLeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([
    { description: '', quantity: 1, unit: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + item.quantity * item.unit * 100, 0);

  function updateItem(index: number, patch: Partial<DraftItem>): void {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  async function create(): Promise<void> {
    if (saving) return;

    const valid = items.filter((item) => item.description.trim() !== '');
    if (!title.trim() || valid.length === 0) {
      setError('Informe um título e ao menos um item com descrição.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await clientApi('/proposals', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          leadId: leadId || undefined,
          notes: notes.trim() || undefined,
          items: valid.map((item) => ({
            description: item.description.trim(),
            quantity: item.quantity,
            unitCents: Math.round(item.unit * 100),
          })),
        }),
      });

      setCreating(false);
      setTitle('');
      setLeadId('');
      setNotes('');
      setItems([{ description: '', quantity: 1, unit: 0 }]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: ProposalStatus): Promise<void> {
    await clientApi(`/proposals/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  async function remove(id: string): Promise<void> {
    await clientApi(`/proposals/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  const field =
    'w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-navy-900';

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Propostas"
          value={formatInteger(initial.summary.total)}
          hint={`${initial.summary.draft} em rascunho`}
          icon={FileText}
        />
        <KpiCard
          label="Enviadas"
          value={formatInteger(initial.summary.sent)}
          icon={FileText}
        />
        <KpiCard
          label="Aceitas"
          value={formatInteger(initial.summary.accepted)}
          hint={`${initial.summary.conversionRate}% de conversão`}
          icon={FileText}
          highlight
        />
        <KpiCard
          label="Valor fechado"
          value={formatBRL(initial.summary.wonCents)}
          hint="somente propostas aceitas"
          icon={FileText}
        />
      </div>

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(!creating)}
          className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
        >
          {creating ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {creating ? 'Cancelar' : 'Nova proposta'}
        </button>
      </div>

      {creating ? (
        <section className="pa-card mb-4 p-4">
          <h2 className="text-card-title text-navy-900">Nova proposta</h2>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="p-title" className="pa-label mb-1 block">
                Título
              </label>
              <input
                id="p-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex: Site institucional — Clínica Aurora"
                className={field}
              />
            </div>

            <div>
              <label htmlFor="p-lead" className="pa-label mb-1 block">
                Lead <span className="normal-case text-muted">(opcional)</span>
              </label>
              <select
                id="p-lead"
                value={leadId}
                onChange={(event) => setLeadId(event.target.value)}
                className={field}
              >
                <option value="">Sem vínculo</option>
                {leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <span className="pa-label mb-2 block">Itens</span>
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <input
                    value={item.description}
                    onChange={(event) =>
                      updateItem(index, { description: event.target.value })
                    }
                    placeholder="Descrição"
                    aria-label={`Descrição do item ${index + 1}`}
                    className={cn(field, 'min-w-40 flex-1')}
                  />
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(index, { quantity: Number(event.target.value) || 1 })
                    }
                    aria-label={`Quantidade do item ${index + 1}`}
                    className={cn(field, 'w-20')}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unit}
                    onChange={(event) =>
                      updateItem(index, { unit: Number(event.target.value) || 0 })
                    }
                    aria-label={`Valor unitário do item ${index + 1}`}
                    className={cn(field, 'w-28')}
                  />
                  {items.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setItems((current) => current.filter((_, i) => i !== index))
                      }
                      aria-label={`Remover item ${index + 1}`}
                      className="rounded-control border border-line px-2 py-2 text-muted hover:border-danger hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { description: '', quantity: 1, unit: 0 },
                ])
              }
              className="mt-2 inline-flex items-center gap-1 rounded-control border border-line px-3 py-1.5 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Adicionar item
            </button>
          </div>

          <div className="mt-4">
            <label htmlFor="p-notes" className="pa-label mb-1 block">
              Observações
            </label>
            <textarea
              id="p-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={field}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-navy-900">
              Total: {formatBRL(total)}
            </p>
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving}
              className="rounded-control bg-navy-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Criar proposta'}
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      {initial.items.length === 0 ? (
        <div className="pa-card">
          <EmptyState
            icon={FileText}
            title="Nenhuma proposta ainda"
            description="Crie a primeira a partir de um lead do seu pipeline."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {initial.items.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onStatus={changeStatus}
              onRemove={remove}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProposalCard({
  proposal,
  onStatus,
  onRemove,
}: {
  proposal: ProposalView;
  onStatus: (id: string, status: ProposalStatus) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <section className="pa-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-navy-900">{proposal.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {proposal.leadId && proposal.leadName ? (
              <Link
                href={`/leads/${proposal.leadId}`}
                className="text-brand-600 hover:text-brand-700"
              >
                {proposal.leadName}
              </Link>
            ) : (
              'Sem lead vinculado'
            )}{' '}
            · {formatDateTime(proposal.createdAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-navy-900">
            {formatBRL(proposal.totalCents)}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              STATUS_STYLES[proposal.status],
            )}
          >
            {PROPOSAL_STATUS_LABELS[proposal.status]}
          </span>
        </div>
      </div>

      <ul className="mt-3 space-y-1 border-t border-line pt-3">
        {proposal.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-xs">
            <span className="text-navy-900">
              {item.quantity}× {item.description}
            </span>
            <span className="shrink-0 font-mono text-muted">
              {formatBRL(item.totalCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <select
          value={proposal.status}
          disabled={busy}
          onChange={async (event) => {
            setBusy(true);
            await onStatus(proposal.id, event.target.value as ProposalStatus);
            setBusy(false);
          }}
          aria-label={`Status de ${proposal.title}`}
          className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900"
        >
          {PROPOSAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROPOSAL_STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        {proposal.status === 'ACCEPTED' ? (
          <span className="text-[11px] text-success">
            Lead movido para Fechado automaticamente
          </span>
        ) : null}

        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            await onRemove(proposal.id);
            setBusy(false);
          }}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-control px-2 py-1.5 text-xs text-muted hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Excluir
        </button>
      </div>
    </section>
  );
}
