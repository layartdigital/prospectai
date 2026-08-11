import type { LeadFacets, LeadListResponse } from '@propectai/types';
import { Lock, Star, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import {
  ScoreBadge,
  WebsiteBadge,
  WhatsAppBadge,
} from '@/components/leads/badges';
import { ExportLeadsButton } from '@/components/leads/export-leads-button';
import { LeadsFilters } from '@/components/leads/leads-filters';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getSession } from '@/lib/session';
import { serverApi } from '@/lib/server-api';
import { formatInteger } from '@/lib/utils';

export const metadata: Metadata = { title: 'Meus Leads' };

type SearchParams = Record<string, string | string[] | undefined>;

function buildQuery(params: SearchParams): string {
  const allowed = [
    'page',
    'pageSize',
    'search',
    'stateUf',
    'city',
    'category',
    'stageSlug',
    'withoutOwnWebsite',
    'likelyWhatsapp',
    'favoritesOnly',
    'minScore',
    'sortBy',
    'sortDir',
  ];

  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = params[key];
    if (typeof value === 'string' && value !== '') query.set(key, value);
  }
  return query.toString();
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = buildQuery(params);

  const [data, facets, session] = await Promise.all([
    serverApi<LeadListResponse>(`/leads${query ? `?${query}` : ''}`),
    serverApi<LeadFacets>('/leads/facets'),
    getSession(),
  ]);

  const planCode = session?.tenant?.planCode ?? 'FREE';
  const currentPage = data.page;

  const pageHref = (page: number): string => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/leads?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Meus Leads"
        subtitle={`${formatInteger(data.total)} ${data.total === 1 ? 'lead' : 'leads'} no total.`}
        // A exportação recebe a mesma query da listagem: o arquivo sai com o
        // recorte que está na tela, não com a base inteira.
        action={<ExportLeadsButton query={query} />}
      />

      {planCode === 'FREE' ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
          <Lock className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 text-xs text-navy-900">
            <strong className="font-semibold">Plano gratuito:</strong> os telefones
            aparecem parcialmente ocultos. Assine para ver o contato completo.
          </p>
          <Link
            href="/subscription"
            className="rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
          >
            Ver planos
          </Link>
        </div>
      ) : null}

      <Suspense fallback={<div className="pa-skeleton mb-4 h-14 w-full" />}>
        <LeadsFilters facets={facets} />
      </Suspense>

      <div className="mb-4 flex flex-wrap gap-2 text-xs text-muted">
        <span className="rounded-full bg-surface px-3 py-1">
          <strong className="font-semibold text-navy-900">
            {formatInteger(data.summary.withoutOwnWebsite)}
          </strong>{' '}
          sem site próprio
        </span>
        <span className="rounded-full bg-surface px-3 py-1">
          <strong className="font-semibold text-navy-900">
            {formatInteger(data.summary.likelyWhatsapp)}
          </strong>{' '}
          WhatsApp provável
        </span>
        <span className="rounded-full bg-surface px-3 py-1">
          <strong className="font-semibold text-navy-900">
            {formatInteger(data.summary.highOpportunity)}
          </strong>{' '}
          alta oportunidade
        </span>
      </div>

      {data.items.length === 0 ? (
        <div className="pa-card">
          <EmptyState
            icon={Users}
            title="Nenhum lead com esses filtros"
            description="Ajuste ou limpe os filtros para ver mais resultados."
          />
        </div>
      ) : (
        <div className="pa-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Empresa</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Localização</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Contato</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Score</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Presença digital</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Etapa</th>
                  <th scope="col" className="px-4 py-2.5" />
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {data.items.map((lead) => (
                  <tr key={lead.id} className="hover:bg-surface-soft/60">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {lead.isFavorite ? (
                          <Star
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning"
                            aria-label="Favorito"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="block truncate text-[13px] font-semibold text-navy-900 hover:text-brand-600"
                          >
                            {lead.name}
                          </Link>
                          <p className="truncate text-xs text-muted">
                            {lead.category ?? 'Categoria não informada'}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-muted">
                      {lead.city ? `${lead.city}, ${lead.stateUf ?? ''}` : '—'}
                    </td>

                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-navy-900">
                        {lead.phone ?? '—'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <ScoreBadge value={lead.score} level={lead.scoreLevel} />
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <WebsiteBadge status={lead.websiteStatus} />
                        <WhatsAppBadge status={lead.whatsappStatus} />
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-muted">
                      {lead.stageName ?? '—'}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
                      >
                        Detalhes
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs">
              <span className="text-muted">
                Página {currentPage} de {data.totalPages}
              </span>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={pageHref(currentPage - 1)}
                    className="rounded-control border border-line px-3 py-1.5 font-medium text-navy-900 hover:border-brand-600"
                  >
                    Anterior
                  </Link>
                ) : null}
                {currentPage < data.totalPages ? (
                  <Link
                    href={pageHref(currentPage + 1)}
                    className="rounded-control border border-line px-3 py-1.5 font-medium text-navy-900 hover:border-brand-600"
                  >
                    Próxima
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
