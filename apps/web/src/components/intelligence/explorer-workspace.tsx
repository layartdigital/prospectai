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
import { useVigiaDeSessao } from './use-vigia-de-sessao';

const FILTRO_VAZIO: FiltroLeads = { search: '', city: '', category: '' };

function mensagem(erro: unknown, padrao: string): string {
  if (erro instanceof ClientApiError) {
    if (erro.statusCode === 404) return 'Não encontrado neste workspace. Ele pode ter sido removido.';
    return erro.message;
  }
  return padrao;
}

export function ExplorerWorkspace({ identidade }: { identidade: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const leadParam = params.get('lead');

  // Sessao/workspace mudou (P04-QA-02). Enquanto `true`, NADA do estado anterior e
  // renderizado, e nenhuma resposta tardia e aceita — ver `descartarTudo`.
  const [sessaoMudou, setSessaoMudou] = useState(false);
  const invalida = useRef(false);
  // Preenchido logo apos `useVigiaDeSessao` (os efeitos abaixo so rodam depois da montagem).
  const vigia = useRef<{ verificarAgora: () => Promise<void> }>({ verificarAgora: async () => undefined });
  const duvidarDaSessao = useCallback((e: unknown): void => {
    if (e instanceof ClientApiError && (e.statusCode === 401 || e.statusCode === 403)) void vigia.current.verificarAgora();
  }, []);

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
      .then((f) => vivo && !invalida.current && setFacetas(f))
      .catch(() => vivo && !invalida.current && setFacetas({ states: [], cities: [], categories: [], stages: [] }));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (invalida.current) return;
    let vivo = true;
    setBuscando(true);
    const espera = setTimeout(() => {
      buscarLeads(filtro)
        .then((r) => {
          if (!vivo || invalida.current) return;
          setResultados(r.items);
          setTotal(r.total);
          setErroBusca(null);
        })
        .catch((e: unknown) => {
          if (!vivo || invalida.current) return;
          setErroBusca(mensagem(e, 'Não foi possível buscar os leads.'));
          duvidarDaSessao(e);
        })
        .finally(() => vivo && !invalida.current && setBuscando(false));
    }, 280);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [filtro, duvidarDaSessao]);

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

  // Controle de concorrencia. Toda operacao que muda o grafo pertence a uma
  // "geracao": trocar de lead, recomecar, desmontar a tela ou mudar a sessao a
  // encerra. Resposta que chega depois de a geracao mudar e descartada — nunca
  // entra no grafo de outro contexto. As requisicoes tambem sao abortadas, mas o
  // descarte por geracao e o que garante a correcao (o abort e so economia).
  //
  // O estado so existe em memoria desta tela: nao ha cache entre leads nem entre
  // workspaces.
  const geracao = useRef(0);
  const abortador = useRef<AbortController | null>(null);
  const emVoo = useRef(new Set<string>());
  const grafoRef = useRef(grafo);
  const posicoesRef = useRef(posicoes);

  const aplicarGrafo = useCallback((g: { nodes: GraphNode[]; edges: GraphEdge[] }, pos: ReadonlyMap<string, Ponto>): void => {
    grafoRef.current = g;
    posicoesRef.current = pos;
    setGrafo(g);
    setPosicoes(pos);
  }, []);

  /** Encerra a geracao atual e devolve a nova (cancela o que estava em andamento). */
  const novaGeracao = useCallback((): { id: number; sinal: AbortSignal } => {
    abortador.current?.abort();
    abortador.current = new AbortController();
    emVoo.current = new Set();
    geracao.current += 1;
    return { id: geracao.current, sinal: abortador.current.signal };
  }, []);

  useEffect(
    () => () => {
      abortador.current?.abort();
      geracao.current += 1;
    },
    [],
  );

  /**
   * A sessao ou o workspace mudou: joga fora TUDO o que pertence ao dono anterior.
   * Grafo, selecao (e com ela o painel de detalhes), cursores de paginacao, filtros de
   * tipo, limites omitidos, resultados de busca e erros. Requisicoes pendentes sao
   * abortadas e suas respostas tardias descartadas pela geracao (`novaGeracao`) e por
   * `invalida`. Nada e reaproveitado: a tela so volta com a chave nova do servidor.
   */
  const descartarTudo = useCallback((): void => {
    invalida.current = true;
    novaGeracao();
    cursores.current = new Map();
    aplicarGrafo({ nodes: [], edges: [] }, new Map());
    setSelecionado(null);
    setOcultos(new Set());
    setCortados({});
    setCarregandoGrafo(false);
    setExpandindo(null);
    setErroGrafo(null);
    setErroExpansao(null);
    setFacetas(null);
    setResultados([]);
    setTotal(0);
    setBuscando(false);
    setErroBusca(null);
    setSessaoMudou(true);
  }, [aplicarGrafo, novaGeracao]);

  vigia.current = useVigiaDeSessao({
    identidade,
    aoMudar: () => {
      descartarTudo();
      // Sai do lead do workspace anterior (ele nem existe no novo) e pede ao servidor a identidade nova.
      router.replace('/intelligence', { scroll: false });
      router.refresh();
    },
    // 401 sem prova de troca: o servidor renova (ou manda para o login) e devolve a chave certa.
    aoIncerta: () => router.refresh(),
  });

  const [demoraRefresh, setDemoraRefresh] = useState(false);
  useEffect(() => {
    if (!sessaoMudou) return;
    const t = setTimeout(() => setDemoraRefresh(true), 6000);
    return () => clearTimeout(t);
  }, [sessaoMudou]);

  const carregar = useCallback(
    async (leadId: string): Promise<void> => {
      if (invalida.current) return;
      const { id, sinal } = novaGeracao();
      setCarregandoGrafo(true);
      setExpandindo(null);
      setErroGrafo(null);
      setErroExpansao(null);
      // Limpa antes de pedir: enquanto o novo lead carrega, nenhum dado do anterior fica na tela.
      cursores.current = new Map();
      aplicarGrafo({ nodes: [], edges: [] }, new Map());
      setSelecionado(null);
      setCortados({});
      try {
        const r = await buscarGrafo(leadId, sinal);
        if (id !== geracao.current) return;
        aplicarGrafo({ nodes: r.nodes, edges: r.edges }, calcularLayout(r.nodes, r.edges));
        setCortados(r.omitted);
        setSelecionado(r.rootRef);
        setOcultos(new Set());
      } catch (e) {
        if (id !== geracao.current) return;
        aplicarGrafo({ nodes: [], edges: [] }, new Map());
        setErroGrafo(mensagem(e, 'Não foi possível carregar o grafo deste lead.'));
        duvidarDaSessao(e);
      } finally {
        if (id === geracao.current) setCarregandoGrafo(false);
      }
    },
    [aplicarGrafo, novaGeracao, duvidarDaSessao],
  );

  useEffect(() => {
    if (invalida.current) return;
    if (leadParam) void carregar(leadParam);
    else {
      novaGeracao();
      aplicarGrafo({ nodes: [], edges: [] }, new Map());
      setSelecionado(null);
      setErroGrafo(null);
      setErroExpansao(null);
      setExpandindo(null);
      setCarregandoGrafo(false);
    }
  }, [leadParam, carregar, novaGeracao, aplicarGrafo]);

  const escolherLead = useCallback(
    (leadId: string): void => {
      router.replace(`/intelligence?lead=${encodeURIComponent(leadId)}`, { scroll: false });
    },
    [router],
  );

  const expandir = useCallback(
    async (no: GraphNode, kind: GraphNodeKind): Promise<void> => {
      if (invalida.current) return;
      const chave = `${no.ref}|${kind}`;
      // Mesma expansao ja em andamento: ignora o clique repetido (nao busca a mesma pagina duas vezes).
      if (emVoo.current.has(chave)) return;
      emVoo.current.add(chave);

      const id = geracao.current;
      const sinal = abortador.current?.signal;
      setExpandindo(chave);
      setErroExpansao(null);
      try {
        const offset = cursores.current.get(chave) ?? 0;
        const r = await expandirNo(
          {
            ref: no.ref,
            kind,
            offset,
            pageSize: GRAPH_LIMITS.defaultPageSize,
            parentDepth: no.depth,
            parentDepthProof: no.depthProof ?? '',
          },
          sinal,
        );
        // O lead mudou (ou a tela foi reiniciada) enquanto esta resposta viajava: descarta.
        if (id !== geracao.current) return;

        // Sempre sobre o grafo MAIS RECENTE (ref), e nao sobre o do momento do clique:
        // duas expansoes sobrepostas nao podem apagar o resultado uma da outra.
        const atual = grafoRef.current;
        const jaTem = new Set(atual.nodes.map((n) => n.ref));
        const realmenteNovos = r.nodes.filter((n) => !jaTem.has(n.ref)).length;
        if (atual.nodes.length + realmenteNovos > GRAPH_LIMITS.maxNodesOnCanvas) {
          setErroExpansao(
            `O grafo chegou ao limite de ${GRAPH_LIMITS.maxNodesOnCanvas} entidades. Recomece a partir de um lead para continuar.`,
          );
          return;
        }

        const fundido = fundirGrafo(atual, { nodes: r.nodes, edges: r.edges });
        aplicarGrafo(fundido, calcularLayout(fundido.nodes, fundido.edges, { fixos: posicoesRef.current, iteracoes: 160 }));
        cursores.current.set(chave, r.expanded.nextOffset ?? Number.MAX_SAFE_INTEGER);
        setCortados((c) => ({ ...c, ...r.omitted }));
      } catch (e) {
        if (id !== geracao.current) return;
        setErroExpansao(mensagem(e, 'Não foi possível carregar estas relações.'));
        duvidarDaSessao(e);
      } finally {
        if (id === geracao.current) {
          emVoo.current.delete(chave);
          setExpandindo((atual) => (atual === chave ? null : atual));
        }
      }
    },
    [aplicarGrafo, duvidarDaSessao],
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

  // Sessao/workspace mudou: nenhuma entidade, resultado ou detalhe do dono anterior e desenhado.
  if (sessaoMudou) {
    return (
      <div
        className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-6 text-center"
        role="status"
        data-testid="explorer-sessao-mudou"
      >
        <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
        <p className="text-sm font-semibold text-navy-900">A sessão ou o workspace mudou</p>
        <p className="max-w-sm text-xs text-muted">
          Por segurança, descartamos o grafo, os detalhes e os resultados que estavam na tela. Atualizando com a sessão atual…
        </p>
        <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" />
        {demoraRefresh ? (
          <button
            type="button"
            onClick={() => window.location.assign('/intelligence')}
            className="rounded-control bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Recarregar a página
          </button>
        ) : null}
      </div>
    );
  }

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
            <strong className="text-navy-900">3. Interprete.</strong> Linha cheia e selo “Vínculo no cadastro” = a ligação
            existe no cadastro, sem conferência externa. Sinal cinza “Desconhecido” = não foi verificado, o que não significa que não exista. A análise por IA
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
