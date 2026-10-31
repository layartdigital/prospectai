'use client';

import {
  GRAPH_NODE_KIND_LABELS,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
} from '@propectai/types';
import { ExternalLink, Loader2, Network, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { estiloDoNo, humanizarDatas } from './graph-style';

interface Props {
  no: GraphNode | null;
  porRef: ReadonlyMap<string, GraphNode>;
  arestas: GraphEdge[];
  carregando: string | null;
  erro: string | null;
  onExpandir: (no: GraphNode, kind: GraphNodeKind) => void;
  onCentrar: (leadId: string) => void;
  onSelecionar: (ref: string) => void;
}

const ESTADO_ROTULO = {
  PRESENTE: 'Presente',
  AUSENTE: 'Ausente',
  DESCONHECIDO: 'Desconhecido',
} as const;

const ESTADO_CLASSE = {
  PRESENTE: 'bg-success/10 text-success',
  AUSENTE: 'bg-danger/10 text-danger',
  DESCONHECIDO: 'bg-surface-soft text-muted',
} as const;

const LIMITE_CONEXOES = 8;

/** Rotulo do vizinho na lista de conexoes: nome, e a data/estado quando ajuda a diferenciar. */
function nomeDoVizinho(n: GraphNode | undefined, padrao: string): string {
  if (!n) return padrao;
  return humanizarDatas(n.label);
}

export function NodeDetailsPanel({ no, porRef, arestas, carregando, erro, onExpandir, onCentrar, onSelecionar }: Props) {
  const [todas, setTodas] = useState(false);

  if (!no) {
    return (
      <section className="pa-card p-4" aria-label="Detalhes da entidade" data-tour="explorer-details">
        <h2 className="text-card-title text-navy-900">Detalhes</h2>
        <p className="mt-2 text-xs text-muted">
          Selecione uma entidade no grafo para ver seus dados, a origem de cada conexão e o que ainda pode ser carregado.
        </p>
      </section>
    );
  }

  const est = estiloDoNo(no);
  const ligacoes = arestas.filter((e) => e.source === no.ref || e.target === no.ref);
  const leadId = no.kind === 'LEAD' ? no.ref.split(':')[1] : null;
  const expansoes = no.expansions.filter((x) => x.total > 0);
  const exibidas = todas ? ligacoes : ligacoes.slice(0, LIMITE_CONEXOES);

  return (
    <section className="pa-card overflow-hidden" aria-label="Detalhes da entidade" data-tour="explorer-details">
      <header className="flex items-start gap-3 border-b border-line p-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: est.fill, boxShadow: `0 0 0 2px ${est.ring}` }}
          aria-hidden="true"
        >
          {est.sigla}
        </span>
        <div className="min-w-0">
          <p className="text-label uppercase tracking-wide text-muted">{GRAPH_NODE_KIND_LABELS[no.kind]}</p>
          <h2 className="break-words text-sm font-semibold text-navy-900">{humanizarDatas(no.label)}</h2>
          {no.sublabel ? <p className="text-xs text-muted">{humanizarDatas(no.sublabel)}</p> : null}
          {no.state ? (
            <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', ESTADO_CLASSE[no.state])}>
              {ESTADO_ROTULO[no.state]}
            </span>
          ) : null}
        </div>
      </header>

      <div className="space-y-4 p-4">
        <dl className="space-y-2">
          {no.properties.map((p) => (
            <div key={p.label} className="grid grid-cols-[110px_1fr] gap-2 text-xs">
              <dt className="text-muted">{p.label}</dt>
              <dd className={cn('break-words', p.value === null ? 'text-muted' : 'font-medium text-navy-900')}>
                {p.value === null ? 'não informado' : humanizarDatas(p.value)}
              </dd>
            </div>
          ))}
        </dl>

        {expansoes.length > 0 ? (
          <div>
            <h3 className="mb-2 text-label uppercase tracking-wide text-muted">Carregar relações</h3>
            <ul className="space-y-1.5">
              {expansoes.map((x) => {
                const falta = x.total - x.loaded;
                const chave = `${no.ref}|${x.kind}`;
                const ocupado = carregando === chave;
                return (
                  <li key={x.kind}>
                    <button
                      type="button"
                      disabled={falta <= 0 || carregando !== null}
                      onClick={() => onExpandir(no, x.kind)}
                      className="flex w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line disabled:hover:text-navy-900"
                    >
                      <span>
                        {GRAPH_NODE_KIND_LABELS[x.kind]}
                        <span className="ml-1 font-normal text-muted">
                          ({x.loaded} de {x.total} no grafo)
                        </span>
                      </span>
                      {ocupado ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Carregando" />
                      ) : (
                        <span className="text-brand-600">{falta > 0 ? 'Carregar' : 'Completo'}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {erro ? (
              <p role="alert" className="mt-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-label uppercase tracking-wide text-muted">
            Conexões ({ligacoes.length})
          </h3>
          {ligacoes.length === 0 ? (
            <p className="text-xs text-muted">Nenhuma conexão carregada para esta entidade.</p>
          ) : (
            <ul className="space-y-2">
              {exibidas.map((e) => {
                const saida = e.source === no.ref;
                const outro = porRef.get(saida ? e.target : e.source);
                const verificada = e.verification === 'VERIFICADA';
                return (
                  <li key={e.id} className="rounded-control border border-line p-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-navy-900">
                        <span className="text-muted">{saida ? 'Esta entidade' : nomeDoVizinho(outro, 'Entidade')}</span>{' '}
                        <span aria-hidden="true" className="text-muted">—</span>{' '}
                        <strong>{e.label}</strong>{' '}
                        <span aria-hidden="true" className="text-muted">→</span>{' '}
                        <button
                          type="button"
                          className="font-semibold text-brand-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                          onClick={() => outro && onSelecionar(outro.ref)}
                          disabled={!outro}
                        >
                          {saida ? nomeDoVizinho(outro, 'entidade') : 'esta entidade'}
                        </button>
                      </p>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          verificada ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                        )}
                      >
                        {verificada ? (
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
                        )}
                        {verificada ? 'Verificada' : 'Inferida'}
                      </span>
                    </div>
                    <p className="mt-1 text-muted">{e.provenance.description}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted">Origem: {e.provenance.source}</p>
                    {e.metadata
                      .filter((m) => m.value !== null)
                      .map((m) => (
                        <p key={m.label} className="mt-0.5 text-muted">
                          {m.label}: <span className="text-navy-900">{humanizarDatas(m.value ?? '')}</span>
                        </p>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
          {ligacoes.length > LIMITE_CONEXOES ? (
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              className="mt-2 text-xs font-semibold text-brand-600 underline-offset-2 hover:underline"
            >
              {todas ? 'Mostrar menos' : `Mostrar todas as ${ligacoes.length} conexões`}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {no.detailHref ? (
            <Link
              href={no.detailHref}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 hover:text-brand-600"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir na aplicação
            </Link>
          ) : null}
          {leadId ? (
            <button
              type="button"
              onClick={() => onCentrar(leadId)}
              className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <Network className="h-3.5 w-3.5" aria-hidden="true" />
              Explorar a partir deste lead
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
