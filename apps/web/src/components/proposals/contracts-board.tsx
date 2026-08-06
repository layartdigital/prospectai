'use client';

import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  type ContractListResponse,
  type ContractStatus,
  type ProposalView,
} from '@propectai/types';
import { FileSignature, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { clientApi } from '@/lib/client-api';
import { cn, formatDateTime, formatInteger } from '@/lib/utils';

const STATUS_STYLES: Record<ContractStatus, string> = {
  DRAFT: 'bg-surface-soft text-muted',
  SENT: 'bg-info/10 text-info',
  SIGNED: 'bg-success/10 text-success',
  CANCELLED: 'bg-danger/10 text-danger',
};

export function ContractsBoard({
  initial,
  proposals,
}: {
  initial: ContractListResponse;
  proposals: ProposalView[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    if (saving || !title.trim()) {
      setError('Informe um título para o contrato.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await clientApi('/contracts', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          proposalId: proposalId || undefined,
          content: content.trim() || undefined,
        }),
      });

      setCreating(false);
      setTitle('');
      setProposalId('');
      setContent('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: ContractStatus): Promise<void> {
    await clientApi(`/contracts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  const field =
    'w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-navy-900';

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Contratos"
          value={formatInteger(initial.summary.total)}
          icon={FileSignature}
        />
        <KpiCard
          label="Rascunho"
          value={formatInteger(initial.summary.draft)}
          icon={FileSignature}
        />
        <KpiCard
          label="Enviados"
          value={formatInteger(initial.summary.sent)}
          icon={FileSignature}
        />
        <KpiCard
          label="Assinados"
          value={formatInteger(initial.summary.signed)}
          icon={FileSignature}
          highlight
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
          {creating ? 'Cancelar' : 'Novo contrato'}
        </button>
      </div>

      {creating ? (
        <section className="pa-card mb-4 p-4">
          <h2 className="text-card-title text-navy-900">Novo contrato</h2>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="c-title" className="pa-label mb-1 block">
                Título
              </label>
              <input
                id="c-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex: Contrato de desenvolvimento — Clínica Aurora"
                className={field}
              />
            </div>

            <div>
              <label htmlFor="c-proposal" className="pa-label mb-1 block">
                Proposta <span className="normal-case text-muted">(opcional)</span>
              </label>
              <select
                id="c-proposal"
                value={proposalId}
                onChange={(event) => setProposalId(event.target.value)}
                className={field}
              >
                <option value="">Sem vínculo</option>
                {proposals.map((proposal) => (
                  <option key={proposal.id} value={proposal.id}>
                    {proposal.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label htmlFor="c-content" className="pa-label mb-1 block">
              Conteúdo
            </label>
            <textarea
              id="c-content"
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Cole ou escreva as cláusulas do contrato…"
              className={field}
            />
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving}
              className="rounded-control bg-navy-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Criar contrato'}
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
            icon={FileSignature}
            title="Nenhum contrato ainda"
            description="Crie um contrato a partir de uma proposta aceita."
          />
        </div>
      ) : (
        <div className="pa-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Contrato</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Proposta</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Criado</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {initial.items.map((contract) => (
                  <tr key={contract.id} className="hover:bg-surface-soft/60">
                    <td className="px-4 py-3 text-[13px] font-semibold text-navy-900">
                      {contract.title}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {contract.proposalTitle ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {contract.leadName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatDateTime(contract.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={contract.status}
                          onChange={(event) =>
                            void changeStatus(
                              contract.id,
                              event.target.value as ContractStatus,
                            )
                          }
                          aria-label={`Status de ${contract.title}`}
                          className={cn(
                            'rounded-full border-0 px-2 py-1 text-[11px] font-medium',
                            STATUS_STYLES[contract.status],
                          )}
                        >
                          {CONTRACT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {CONTRACT_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        {contract.signedAt ? (
                          <span className="text-[11px] text-muted">
                            {formatDateTime(contract.signedAt)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* O produto não assina nada. Dizer isso é melhor do que deixar o
          usuário descobrir depois que confiou. */}
      <p className="mt-4 rounded-card border border-dashed border-line px-4 py-3 text-xs text-muted">
        Não há assinatura digital integrada nesta versão. Marcar como assinado
        registra que a assinatura aconteceu fora do produto — o documento com
        validade jurídica continua sendo o que você assinou por outro meio.
      </p>
    </>
  );
}
