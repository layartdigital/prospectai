import type { HistoryResponse } from '@propectai/types';
import { Copy, History, Layers, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';
import { formatDateTime, formatInteger } from '@/lib/utils';

export const metadata: Metadata = { title: 'Histórico' };

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-success/10 text-success',
  FAILED: 'bg-danger/10 text-danger',
  RUNNING: 'bg-brand-600/10 text-brand-600',
  PENDING: 'bg-surface-soft text-muted',
  QUEUED: 'bg-surface-soft text-muted',
  CANCELLED: 'bg-surface-soft text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  RUNNING: 'Em andamento',
  PENDING: 'Na fila',
  QUEUED: 'Na fila',
  CANCELLED: 'Cancelada',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export default async function HistoryPage() {
  const data = await serverApi<HistoryResponse>('/prospecting/searches');

  return (
    <>
      <PageHeader
        title="Histórico de Buscas"
        subtitle="Visualize e gerencie suas prospecções anteriores."
        action={
          <Link
            href="/search"
            className="rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Nova Busca
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total de buscas"
          value={formatInteger(data.kpis.totalSearches)}
          icon={History}
        />
        <KpiCard
          label="Total de leads"
          value={formatInteger(data.kpis.totalLeads)}
          icon={Layers}
        />
        <KpiCard
          label="Média por busca"
          value={formatInteger(data.kpis.averagePerSearch)}
          icon={TrendingUp}
        />
        <KpiCard
          label="Taxa de duplicidade"
          value={`${data.kpis.duplicateRate}%`}
          hint="duplicados não consomem cota"
          icon={Copy}
        />
      </div>

      <div className="pa-card mt-4 overflow-hidden">
        {data.items.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nenhuma busca realizada"
            description="Suas prospecções aparecem aqui assim que a primeira busca for concluída."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Nicho</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Localização</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Leads</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Duplicados</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Duração</th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-soft/60">
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatDateTime(item.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-navy-900">
                      {item.niche}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {item.city}, {item.stateUf}
                      {item.neighborhood ? ` · ${item.neighborhood}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          STATUS_STYLES[item.status] ?? STATUS_STYLES.PENDING
                        }`}
                        title={item.errorMessage ?? undefined}
                      >
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-900">
                      {formatInteger(item.leadsFound)}
                      <span className="text-muted"> de {item.requestedCount}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatInteger(item.duplicatesFound)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {formatDuration(item.durationMs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/leads?search=${encodeURIComponent(item.niche)}`}
                        className="rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
                      >
                        Ver leads
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
