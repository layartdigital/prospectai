'use client';

import {
  GRAPH_LIMITS,
  GRAPH_NODE_KIND_LABELS,
  INTELLIGENCE_INCREMENT,
  INTELLIGENCE_MODULE_NAME,
  INTELLIGENCE_MODULE_VERSION,
  calcularLayout,
  fundirGrafo,
  vizinhosDiretos,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type LeadFacets,
  type LeadListItem,
  type Ponto,
} from '@propectai/types';
import { AlertTriangle, HelpCircle, Loader2, Network, RotateCcw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ClientApiError } from '@/lib/client-api';
import {
  buscarFacetas,
  buscarGrafo,
  buscarLeads,
  expandirNo,
  type FiltroLeads,
} from '@/lib/intelligence-api';
import { cn } from '@/lib/utils';

import { EntitySearchPanel } from './entity-search-panel';
import { GraphCanvas } from './graph-canvas';
import { KIND_STYLE, humanizarDatas } from './graph-style';
import { NodeDetailsPanel } from './node-details-panel';

const FILTRO_VAZIO: FiltroLeads = { search: '', city: '', category: '' };

function mensagem(erro: unknown, padrao: string): string {
  if (erro instanceof ClientApiError) {
    if (erro.statusCode === 404) return 'Não encontrado neste workspace. Ele pode ter sido removido.';
    return erro.message;
  }
  return padrao;
}

export function ExplorerWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const leadParam = params.get('lead');

  // ---- busca de leads ----------------------------------------------------
  const [filtro, setFiltro] = useState<FiltroLeads>(FILTRO_VAZIO);
  const [facetas, setFacetas] = useState<LeadFacets | null>(null);
  const [resultados, setResultados] = useState<LeadListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [buscando, setBuscando] = useState(true);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    buscarFacetas()
      .then((f) => vivo && setFacetas(f))
      .catch(() => vivo && setFacetas({ states: [], cities: [], categories: [], stages: [] }));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    setBuscando(true);
    const espera = setTimeout(() => {
      buscarLeads(filtro)
        .then((r) => {
          if (!vivo) return;
          setResultados(r.items);
          setTotal(r.total);
          setErroBusca(null);
        })
        .catch((e: unknown) => vivo && setErroBusca(mensagem(e, 'Não foi possível buscar os leads.')))
        .finally(() => vivo && setBuscando(false));
    }, 280);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [filtro]);

  // ---- grafo -------------------------------------------------------------
  const [grafo, setGrafo] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [posicoes, setPosicoes] = useState<ReadonlyMap<string, Ponto>>(new Map());
  const cursores = useRef(new Map<string, number>());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [ocultos, setOcultos] = useState<ReadonlySet<GraphNodeKind>>(new Set());
  const [carregandoGrafo, setCarregandoGrafo] = useState(false);
  const [erroGrafo, setErroGrafo] = useState<string | null>(null);
  const [expandindo, setExpandindo] = useState<string | null>(null);
  const [erroExpansao, setErroExpansao] = useState<string | null>(null);
  const [cortados, setCortados] = useState<Partial<Record<GraphNodeKind, number>>>({});

  const carregar = useCallback(async (leadId: string): Promise<void> => {
    setCarregandoGrafo(true);
    setErroGrafo(null);
    setErroExpansao(null);
    try {
      const r = await buscarGrafo(leadId);
      cursores.current = new Map();
      setGrafo({ nodes: r.nodes, edges: r.edges });
      setPosicoes(calcularLayout(r.nodes, r.edges));
      setCortados(r.omitted);
      setSelecionado(r.rootRef);
      setOcultos(new Set());
    } catch (e) {
      setGrafo({ nodes: [], edges: [] });
      setPosicoes(new Map());
      setErroGrafo(mensagem(e, 'Não foi possível carregar o grafo deste lead.'));
    } finally {
      setCarregandoGrafo(false);
    }
  }, []);

  useEffect(() => {
    if (leadParam) void carregar(leadParam);
    else {
      setGrafo({ nodes: [], edges: [] });
      setPosicoes(new Map());
      setSelecionado(null);
      setErroGrafo(null);
    }
  }, [leadParam, carregar]);

  const escolherLead = useCallback(
    (leadId: string): void => {
      router.replace(`/intelligence?lead=${encodeURIComponent(leadId)}`, { scroll: false });
    },
    [router],
  );

  const expandir = useCallback(
    async (no: GraphNode, kind: GraphNodeKind): Promise<void> => {
      const chave = `${no.ref}|${kind}`;
      setExpandindo(chave);
      setErroExpansao(null);
      try {
        const offset = cursores.current.get(chave) ?? 0;
        const r = await expandirNo({
          ref: no.ref,
          kind,
          offset,
          pageSize: GRAPH_LIMITS.defaultPageSize,
          parentDepth: no.depth,
        });

        const novosRefs = new Set(r.nodes.map((n) => n.ref));
        const jaTem = new Set(grafo.nodes.map((n) => n.ref));
        const realmenteNovos = [...novosRefs].filter((x) => !jaTem.has(x)).length;
        if (grafo.nodes.length + realmenteNovos > GRAPH_LIMITS.maxNodesOnCanvas) {
          setErroExpansao(
            `O grafo chegou ao limite de ${GRAPH_LIMITS.maxNodesOnCanvas} entidades. Recomece a partir de um lead para continuar.`,
          );
          return;
        }

        const fundido = fundirGrafo(grafo, { nodes: r.nodes, edges: r.edges });
        setGrafo(fundido);
        setPosicoes(calcularLayout(fundido.nodes, fundido.edges, { fixos: posicoes, iteracoes: 160 }));
        if (r.expanded.nextOffset !== null) cursores.current.set(chave, r.expanded.nextOffset);
        else cursores.current.set(chave, Number.MAX_SAFE_INTEGER);
        setCortados((c) => ({ ...c, ...r.omitted }));
      } catch (e) {
        setErroExpansao(mensagem(e, 'Não foi possível carregar estas relações.'));
      } finally {
        setExpandindo(null);
      }
    },
    [grafo, posicoes],
  );

  // ---- derivados ---------------------------------------------------------
  const visiveis = useMemo(() => {
    const nodes = grafo.nodes.filter((n) => !ocultos.has(n.kind) || n.depth === 0);
    const refs = new Set(nodes.map((n) => n.ref));
    return { nodes, edges: grafo.edges.filter((e) => refs.has(e.source) && refs.has(e.target)) };
  }, [grafo, ocultos]);

  const porRef = useMemo(() => new Map(grafo.nodes.map((n) => [n.ref, n] as const)), [grafo.nodes]);
  const noSelecionado = selecionado ? (porRef.get(selecionado) ?? null) : null;
  const destaque = useMemo(
    () => (selecionado ? vizinhosDiretos(visiveis.edges, selecionado) : { nodes: new Set<string>(), edges: new Set<string>() }),
    [selecionado, visiveis.edges],
  );

  const contagemPorTipo = useMemo(() => {
    const m = new Map<GraphNodeKind, number>();
    for (const n of grafo.nodes) m.set(n.kind, (m.get(n.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [grafo.nodes]);

  const alternarTipo = (kind: GraphNodeKind): void =>
    setOcultos((atual) => {
      const novo = new Set(atual);
      if (novo.has(kind)) novo.delete(kind);
      else novo.add(kind);
      return novo;
    });

  const temGrafo = grafo.nodes.length > 0;
  const ajusteKey = `${leadParam ?? ''}:${visiveis.nodes.length}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3" data-tour="explorer-header">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-page-title text-navy-900">
            {INTELLIGENCE_MODULE_NAME}
            <span
              className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700"
              title={`Incremento ${INTELLIGENCE_INCREMENT}`}
            >
              v{INTELLIGENCE_MODULE_VERSION}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Veja como um lead se liga à pesquisa que o encontrou, ao score, à presença digital e ao pipeline. Só aparecem
            conexões comprovadas no cadastro.
          </p>
        </div>
        {leadParam ? (
          <button
            type="button"
            onClick={() => void carregar(leadParam)}
            disabled={carregandoGrafo}
            className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Recomeçar deste lead
          </button>
        ) : null}
      </header>

      <details className="pa-card group" open={!leadParam}>
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-card-title text-navy-900 marker:content-none">
          <HelpCircle className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Como usar
        </summary>
        <div className="grid gap-4 border-t border-line px-4 py-3 text-xs text-muted md:grid-cols-3">
          <p>
            <strong className="text-navy-900">1. Escolha um lead.</strong> Busque pelo nome ou filtre por cidade e categoria
            no painel da esquerda e clique no resultado.
          </p>
          <p>
            <strong className="text-navy-900">2. Navegue.</strong> Clique numa entidade para ver os dados e a origem de cada
            conexão. Use “Carregar” no painel da direita para trazer notas, atividades, auditorias e outras relações. O
            número escuro em cada círculo é quanto ainda falta carregar.
          </p>
          <p>
            <strong className="text-navy-900">3. Interprete.</strong> Linha cheia e selo “Verificada” = a ligação existe no
            cadastro. Sinal cinza “Desconhecido” = não foi verificado, o que não significa que não exista. A análise por IA
            ainda não está disponível nesta versão.
          </p>
        </div>
      </details>

      <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)_330px]">
        <div className="space-y-4">
          <EntitySearchPanel
            filtro={filtro}
            onFiltro={setFiltro}
            facetas={facetas}
            resultados={resultados}
            total={total}
            carregando={buscando}
            erro={erroBusca}
            selecionadoId={leadParam}
            onEscolher={escolherLead}
          />

          {temGrafo ? (
            <section className="pa-card p-4" aria-label="Tipos de entidade no grafo" data-tour="explorer-filters">
              <h2 className="text-card-title text-navy-900">Tipos no grafo</h2>
              <ul className="mt-2 space-y-1">
                {contagemPorTipo.map(([kind, n]) => {
                  const fixo = kind === 'LEAD';
                  return (
                    <li key={kind}>
                      <label className={cn('flex items-center gap-2 text-xs', fixo ? 'opacity-70' : 'cursor-pointer')}>
                        <input
                          type="checkbox"
                          checked={fixo || !ocultos.has(kind)}
                          disabled={fixo}
                          onChange={() => alternarTipo(kind)}
                          className="h-3.5 w-3.5 accent-brand-600"
                        />
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ background: KIND_STYLE[kind].fill }}
                          aria-hidden="true"
                        />
                        <span className="text-navy-900">{GRAPH_NODE_KIND_LABELS[kind]}</span>
                        <span className="ml-auto text-muted">{n}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] text-muted">
                {grafo.nodes.length} de no máximo {GRAPH_LIMITS.maxNodesOnCanvas} entidades no grafo.
                {Object.keys(cortados).length > 0 ? ' Alguns itens foram omitidos pelo limite por resposta.' : ''}
              </p>
            </section>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="h-[62vh] min-h-[380px] lg:h-[calc(100vh-17rem)]">
            {carregandoGrafo ? (
              <div className="flex h-full items-center justify-center rounded-card border border-line bg-surface" role="status">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Montando o grafo…
                </p>
              </div>
            ) : erroGrafo ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-6 text-center" role="alert">
                <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
                <p className="text-sm font-semibold text-navy-900">Não foi possível montar o grafo</p>
                <p className="max-w-sm text-xs text-muted">{erroGrafo}</p>
                {leadParam ? (
                  <button
                    type="button"
                    onClick={() => void carregar(leadParam)}
                    className="rounded-control bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    Tentar de novo
                  </button>
                ) : null}
              </div>
            ) : !temGrafo ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line bg-surface px-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Network className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="text-sm font-semibold text-navy-900">Nenhum lead selecionado</p>
                <p className="max-w-sm text-xs text-muted">
                  Escolha um lead no painel da esquerda, ou use “Explorar relações” na ficha de um lead. O grafo mostra
                  apenas o que existe no seu workspace.
                </p>
              </div>
            ) : (
              <GraphCanvas
                nodes={visiveis.nodes}
                edges={visiveis.edges}
                positions={posicoes}
                selectedRef={selecionado}
                destaqueNos={destaque.nodes}
                destaqueArestas={destaque.edges}
                onSelect={setSelecionado}
                ajusteKey={ajusteKey}
              />
            )}
          </div>

          {/* Alternativa em texto ao grafo: leitores de tela e quem prefere lista. */}
          {temGrafo ? (
            <ul className="sr-only" aria-label="Entidades do grafo em lista">
              {grafo.nodes.map((n) => (
                <li key={n.ref}>
                  {GRAPH_NODE_KIND_LABELS[n.kind]}: {humanizarDatas(n.label)}
                  {n.sublabel ? `, ${humanizarDatas(n.sublabel)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <NodeDetailsPanel
          no={noSelecionado}
          porRef={porRef}
          arestas={grafo.edges}
          carregando={expandindo}
          erro={erroExpansao}
          onExpandir={(no, kind) => void expandir(no, kind)}
          onCentrar={escolherLead}
          onSelecionar={setSelecionado}
        />
      </div>
    </div>
  );
}
