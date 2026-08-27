'use client';

import type { AdminTenantList, AdminTenantView } from '@propectai/types';
import { Ban, Loader2, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { formatDateTime, formatInteger } from '@/lib/utils';

export function TenantsTable({ data }: { data: AdminTenantList }) {
  const router = useRouter();
  // A lista de planos do seletor sai do proprio resumo, que o servidor monta
  // consultando a tabela `plans`. Plano criado no Master aparece aqui sem
  // mudanca de codigo — que e o ponto inteiro do passo 4 do §11.1.
  const planos = Object.keys(data.summary.byPlan);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(id: string, acao: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(id);
    setErro(null);

    try {
      await acao();
      router.refresh();
    } catch (caught) {
      setErro(caught instanceof Error ? caught.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumo rotulo="Ativos" valor={data.summary.active} />
        <Resumo rotulo="Suspensos" valor={data.summary.suspended} destaque={data.summary.suspended > 0} />
        <Resumo rotulo="Demonstração" valor={data.summary.demo} />
        <Resumo rotulo="Total" valor={data.total} />
      </div>

      {erro ? (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
          {erro}
        </p>
      ) : null}

      <div className="pa-card overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left">
          <thead>
            <tr className="border-b border-line text-label uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-2.5 font-semibold">Workspace</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Plano</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Equipe</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Consumo do mês</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Última atividade</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Ações</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {data.items.map((tenant) => (
              <Linha
                key={tenant.id}
                tenant={tenant}
                planos={planos}
                busy={busy === tenant.id}
                onTrocarPlano={(planCode, reason) =>
                  void executar(tenant.id, () =>
                    clientApi(`/admin/tenants/${tenant.id}/plan`, {
                      method: 'PATCH',
                      body: JSON.stringify({ planCode, reason }),
                    }),
                  )
                }
                onSuspender={(reason) =>
                  void executar(tenant.id, () =>
                    clientApi(`/admin/tenants/${tenant.id}/suspend`, {
                      method: 'POST',
                      body: JSON.stringify({ reason }),
                    }),
                  )
                }
                onReativar={() =>
                  void executar(tenant.id, () =>
                    clientApi(`/admin/tenants/${tenant.id}/reactivate`, {
                      method: 'POST',
                    }),
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Linha({
  tenant,
  planos,
  busy,
  onTrocarPlano,
  onSuspender,
  onReativar,
}: {
  tenant: AdminTenantView;
  /**
   * Planos existentes, vindos do servidor.
   *
   * Antes era uma constante de quatro literais neste arquivo. Com a tela de
   * planos do Master, um plano novo simplesmente nao apareceria no seletor —
   * e a tela de trocar plano nao ofereceria o plano recem-criado.
   *
   * As chaves de `summary.byPlan` sao a lista que o banco devolveu, entao o
   * seletor acompanha o banco sem endpoint novo.
   */
  planos: string[];
  busy: boolean;
  onTrocarPlano: (planCode: string, reason: string) => void;
  onSuspender: (reason: string) => void;
  onReativar: () => void;
}) {
  const suspenso = Boolean(tenant.suspendedAt);

  return (
    <tr className={suspenso ? 'bg-danger/5' : undefined}>
      <td className="px-4 py-3">
        <p className="text-[13px] font-semibold text-navy-900">
          {tenant.name}
          {tenant.isDemo ? (
            <span className="ml-2 rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-medium text-muted">
              demo
            </span>
          ) : null}
        </p>
        <p className="text-[11px] text-muted">
          {tenant.country} · {tenant.currency} · {tenant.customerType}
          {tenant.taxId ? ` · ${tenant.taxId}` : ' · sem número fiscal'}
        </p>
        {suspenso ? (
          <p className="mt-0.5 text-[11px] font-medium text-danger">
            Suspenso: {tenant.suspendedReason}
          </p>
        ) : null}
      </td>

      <td className="px-4 py-3">
        <select
          aria-label={`Plano de ${tenant.name}`}
          value={tenant.planCode}
          disabled={busy}
          onChange={(event) => {
            const reason = window.prompt(
              `Motivo da troca para ${event.target.value}:`,
              '',
            );
            // Cancelar o motivo cancela a troca. Sem motivo, o AuditLog vira
            // registro sem explicação — que é quase igual a não ter registro.
            if (!reason || reason.trim().length < 3) {
              event.target.value = tenant.planCode;
              return;
            }
            onTrocarPlano(event.target.value, reason.trim());
          }}
          className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900 disabled:opacity-60"
        >
          {planos.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted">{tenant.subscriptionStatus ?? '—'}</p>
      </td>

      <td className="px-4 py-3 text-xs text-navy-900">{tenant.members}</td>

      <td className="px-4 py-3 text-[11px] text-muted">
        <p>
          Leads {formatInteger(tenant.usage.leadsUsed)}/
          {formatInteger(tenant.usage.leadsIncluded)}
        </p>
        <p>
          IA {formatInteger(tenant.usage.aiGenerationsUsed)}/
          {formatInteger(tenant.usage.aiGenerationsIncluded)}
        </p>
        <p>
          {tenant.usage.searchesCount} buscas · {tenant.usage.exportsCount} exportações
        </p>
      </td>

      <td className="px-4 py-3 text-xs text-muted">
        {formatDateTime(tenant.lastActivityAt)}
      </td>

      <td className="px-4 py-3">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" />
        ) : suspenso ? (
          <button
            type="button"
            onClick={onReativar}
            className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:border-success hover:text-success"
          >
            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Reativar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              const reason = window.prompt(
                `Motivo da suspensão de ${tenant.name}:`,
                '',
              );
              if (!reason || reason.trim().length < 3) return;
              onSuspender(reason.trim());
            }}
            className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger"
          >
            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            Suspender
          </button>
        )}
      </td>
    </tr>
  );
}

function Resumo({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className="pa-card p-3">
      <p className="pa-label">{rotulo}</p>
      <p className={`mt-1 text-kpi ${destaque ? 'text-danger' : 'text-navy-900'}`}>
        {valor}
      </p>
    </div>
  );
}
