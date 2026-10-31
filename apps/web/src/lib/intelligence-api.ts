'use client';

import type {
  GraphExpandResponse,
  GraphNodeKind,
  GraphResponse,
  LeadFacets,
  LeadListResponse,
} from '@propectai/types';

import { clientApi } from './client-api';

/**
 * Cliente do Intelligence Explorer.
 *
 * Reaproveita `GET /leads` e `GET /leads/facets` para achar e filtrar a raiz:
 * sao as mesmas regras de paginacao e de mascara de telefone da lista de leads,
 * e nao ha segunda listagem para divergir. So o grafo tem endpoints proprios.
 */

export interface FiltroLeads {
  search: string;
  city: string;
  category: string;
}

export function buscarGrafo(leadId: string, signal?: AbortSignal): Promise<GraphResponse> {
  return clientApi<GraphResponse>(`/intelligence/graph?leadId=${encodeURIComponent(leadId)}`, signal ? { signal } : {});
}

export function expandirNo(params: {
  ref: string;
  kind: GraphNodeKind;
  offset: number;
  pageSize: number;
  /** `depth` e `depthProof` exatamente como o servidor devolveu para o no pai. */
  parentDepth: number;
  parentDepthProof: string;
}, signal?: AbortSignal): Promise<GraphExpandResponse> {
  const q = new URLSearchParams({
    ref: params.ref,
    kind: params.kind,
    offset: String(params.offset),
    pageSize: String(params.pageSize),
    parentDepth: String(params.parentDepth),
    parentDepthProof: params.parentDepthProof,
  });
  return clientApi<GraphExpandResponse>(`/intelligence/expand?${q.toString()}`, signal ? { signal } : {});
}

export function buscarLeads(filtro: FiltroLeads): Promise<LeadListResponse> {
  const q = new URLSearchParams({ pageSize: '8', sortBy: 'score', sortDir: 'desc' });
  if (filtro.search.trim()) q.set('search', filtro.search.trim());
  if (filtro.city) q.set('city', filtro.city);
  if (filtro.category) q.set('category', filtro.category);
  return clientApi<LeadListResponse>(`/leads?${q.toString()}`);
}

export function buscarFacetas(): Promise<LeadFacets> {
  return clientApi<LeadFacets>('/leads/facets');
}
