import type { DashboardResponse } from '@propectai/types';
import {
  Gauge,
  Globe,
  KanbanSquare,
  MessageCircle,
  Search,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';
import { formatInteger } from '@/lib/utils';

export const metadata: Metadata = { title: 'Visão Geral' };

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  RUNNING: 'Em andamento',
  PENDING: 'Na fila',
  QUEUED: 'Na fila',
  CANCELLED: 'Cancelada',
};

export default async function DashboardPage() {
  const data = await serverApi<DashboardResponse>('/dashboard');
  const { kpis, recentSearches, funnel } = data;

  const funnelTotal = funnel.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <>
      <PageHeader
        title="Visão Geral"
        subtitle="Acompanhe suas oportunidades e prospecções."
        action={
          <Link
            href="/search"
            className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Nova Busca
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label="Leads encontrados"
          value={formatInteger(kpis.leadsFound)}
          hint={`${formatInteger(kpis.leadsThisMonth)} este mês`}
          icon={Users}
        />
        <KpiCard
          label="Oportunidades altas"
          value={formatInteger(kpis.highOpportunities)}
          hint="score acima de 70"
          icon={TrendingUp}
          highlight
        />
        <KpiCard
          label="Pipeline ativo"
          value={formatInteger(kpis.pipelineActive)}
          hint="fora de fechado e perdido"
          icon={KanbanSquare}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Score médio"
          value={formatInteger(kpis.averageScore)}
          hint="de 0 a 100"
          icon={Gauge}
        />
        <KpiCard
          label="Sem site próprio"
          value={formatInteger(kpis.withoutOwnWebsite)}
          hint={`${kpis.withoutWebsite} sem site · ${kpis.poorWebsite} site precário`}
          icon={Globe}
        />
        <KpiCard
          label="WhatsApp provável"
          value={formatInteger(kpis.likelyWhatsapp)}
          hint="número não verificado"
          icon={MessageCircle}
        />
        <KpiCard
          label="Follow-ups"
          value={formatInteger(kpis.pendingFollowUps + kpis.overdueFollowUps)}
          hint={
            kpis.overdueFollowUps > 0
              ? `${kpis.overdueFollowUps} vencidos`
              : 'nenhum vencido'
          }
          icon={Target}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="pa-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-card-title text-navy-900">Buscas recentes</h2>
            <Link
              href="/history"
              className="rounded text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Ver todas
            </Link>
          </div>

          {recentSearches.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nenhuma busca ainda"
              description="Crie sua primeira prospecção para começar a encontrar oportunidades."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentSearches.map((search) => (
                <li
                  key={search.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-navy-900">
                      {search.niche}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {search.city}, {search.stateUf} ·{' '}
                      {STATUS_LABELS[search.status] ?? search.status}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-brand-600">
                    {formatInteger(search.leadsFound)} leads
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pa-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-card-title text-navy-900">Funil de vendas</h2>
            <Link
              href="/pipeline"
              className="rounded text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Kanban
            </Link>
          </div>

          {funnelTotal === 0 ? (
            <EmptyState
              icon={KanbanSquare}
              title="Pipeline vazio"
              description="Adicione leads ao pipeline para visualizar a distribuição por etapa."
            />
          ) : (
            <ul className="space-y-2.5 px-4 py-4">
              {funnel.map((stage) => {
                const share = funnelTotal > 0 ? (stage.count / funnelTotal) * 100 : 0;
                return (
                  <li key={stage.slug}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-navy-900">{stage.name}</span>
                      <span className="text-muted">{formatInteger(stage.count)}</span>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft"
                      role="img"
                      aria-label={`${stage.name}: ${stage.count} de ${funnelTotal} leads`}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(share, stage.count > 0 ? 3 : 0)}%`,
                          backgroundColor: stage.color,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
