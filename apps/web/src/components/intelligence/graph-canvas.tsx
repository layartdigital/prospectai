'use client';

import {
  ajustarVisualizacao,
  zoomEm,
  type Enquadramento,
  type GraphEdge,
  type GraphNode,
  type Ponto,
} from '@propectai/types';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { estiloDoNo, humanizarDatas, rotuloCurto } from './graph-style';

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: ReadonlyMap<string, Ponto>;
  selectedRef: string | null;
  /** Nos e arestas do vizinho direto do selecionado ficam em destaque. */
  destaqueNos: ReadonlySet<string>;
  destaqueArestas: ReadonlySet<string>;
  onSelect: (ref: string | null) => void;
  /** Muda quando o conjunto de nos muda de forma que pede reenquadramento. */
  ajusteKey: string;
}

const PASSO_TECLA = 40;

/**
 * Superficie do grafo: SVG puro, sem biblioteca de grafos.
 *
 * - Zoom pela roda (ancorado no cursor), pelos botoes e por `+` / `-`.
 * - Pan arrastando o fundo e pelas setas.
 * - `0` reenquadra tudo.
 * - Cada no e um botao focavel (Tab / Enter / Espaco); `Esc` limpa a selecao.
 * - A posicao vem de `calcularLayout` (geometria pura, testada); este componente
 *   so desenha.
 */
export function GraphCanvas({
  nodes,
  edges,
  positions,
  selectedRef,
  destaqueNos,
  destaqueArestas,
  onSelect,
  ajusteKey,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tamanho, setTamanho] = useState({ w: 800, h: 520 });
  const [vista, setVista] = useState<Enquadramento>({ scale: 1, tx: 400, ty: 260 });
  const arrasto = useRef<{ x: number; y: number; tx: number; ty: number; moveu: boolean } | null>(null);

  // Acompanha o tamanho real da area (o layout e responsivo).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const medir = (): void => setTamanho({ w: el.clientWidth || 800, h: el.clientHeight || 520 });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const ajustar = useCallback((): void => {
    setVista(ajustarVisualizacao(positions.values(), tamanho.w, tamanho.h));
  }, [positions, tamanho.w, tamanho.h]);

  // Reenquadra quando o conjunto de nos muda de forma relevante ou a area muda.
  useEffect(() => {
    ajustar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajusteKey, tamanho.w, tamanho.h]);

  // A roda precisa de listener nao-passivo para poder impedir o scroll da pagina.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const aoRodar = (ev: WheelEvent): void => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const fator = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      setVista((v) => zoomEm(v, fator, ev.clientX - r.left, ev.clientY - r.top));
    };
    el.addEventListener('wheel', aoRodar, { passive: false });
    return () => el.removeEventListener('wheel', aoRodar);
  }, []);

  const porRef = useMemo(() => new Map(nodes.map((n) => [n.ref, n] as const)), [nodes]);
  const temDestaque = selectedRef !== null;

  function aoPressionar(ev: React.PointerEvent<SVGSVGElement>): void {
    if ((ev.target as Element).closest('[data-no]')) return;
    (ev.currentTarget as SVGSVGElement).setPointerCapture(ev.pointerId);
    arrasto.current = { x: ev.clientX, y: ev.clientY, tx: vista.tx, ty: vista.ty, moveu: false };
  }

  function aoMover(ev: React.PointerEvent<SVGSVGElement>): void {
    const a = arrasto.current;
    if (!a) return;
    const dx = ev.clientX - a.x;
    const dy = ev.clientY - a.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
    setVista((v) => ({ ...v, tx: a.tx + dx, ty: a.ty + dy }));
  }

  function aoSoltar(): void {
    const a = arrasto.current;
    arrasto.current = null;
    // clique no fundo (sem arrastar) limpa a selecao
    if (a && !a.moveu) onSelect(null);
  }

  function aoTeclar(ev: React.KeyboardEvent<SVGSVGElement>): void {
    switch (ev.key) {
      case 'ArrowLeft':
        setVista((v) => ({ ...v, tx: v.tx + PASSO_TECLA }));
        break;
      case 'ArrowRight':
        setVista((v) => ({ ...v, tx: v.tx - PASSO_TECLA }));
        break;
      case 'ArrowUp':
        setVista((v) => ({ ...v, ty: v.ty + PASSO_TECLA }));
        break;
      case 'ArrowDown':
        setVista((v) => ({ ...v, ty: v.ty - PASSO_TECLA }));
        break;
      case '+':
      case '=':
        setVista((v) => zoomEm(v, 1.2, tamanho.w / 2, tamanho.h / 2));
        break;
      case '-':
        setVista((v) => zoomEm(v, 1 / 1.2, tamanho.w / 2, tamanho.h / 2));
        break;
      case '0':
        ajustar();
        break;
      case 'Escape':
        onSelect(null);
        break;
      default:
        return;
    }
    ev.preventDefault();
  }

  // Rotulo em toda aresta vira ruido quando ha dezenas delas (16 "tem nota" sobrepostos):
  // so grafos pequenos rotulam tudo; nos demais, so as arestas do no selecionado.
  const rotularTodas = edges.length <= 14;
  const arestasDoSelecionado = selectedRef ? edges.filter((x) => x.source === selectedRef || x.target === selectedRef).length : 0;
  const rotularDestaque = arestasDoSelecionado <= 8;
  const mostrarRotuloAresta = vista.scale >= 0.85;

  return (
    <div ref={wrapRef} className="relative h-full min-h-[360px] w-full overflow-hidden rounded-card border border-line bg-surface" data-tour="explorer-canvas">
      <svg
        role="group"
        aria-label="Grafo de relações. Use Tab para percorrer as entidades, setas para mover, mais e menos para o zoom, zero para enquadrar."
        tabIndex={0}
        width="100%"
        height="100%"
        className="block cursor-grab touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-brand-600 active:cursor-grabbing"
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={() => (arrasto.current = null)}
        onKeyDown={aoTeclar}
      >
        <defs>
          <pattern id="pa-grade" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="#D8E3F1" />
          </pattern>
          <marker id="pa-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
          </marker>
          <marker id="pa-seta-forte" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2F6BFF" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#pa-grade)" />

        <g transform={`translate(${vista.tx} ${vista.ty}) scale(${vista.scale})`}>
          {edges.map((e) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            const na = porRef.get(e.source);
            const nb = porRef.get(e.target);
            if (!a || !b || !na || !nb) return null;

            const forte = destaqueArestas.has(e.id);
            const apagada = temDestaque && !forte;
            // encurta a linha para a seta terminar na borda do circulo
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const ra = estiloDoNo(na).raio;
            const rb = estiloDoNo(nb).raio + 3;
            const x1 = a.x + (dx / d) * ra;
            const y1 = a.y + (dy / d) * ra;
            const x2 = b.x - (dx / d) * rb;
            const y2 = b.y - (dy / d) * rb;
            const inferida = e.verification === 'INFERIDA';

            return (
              <g key={e.id} opacity={apagada ? 0.18 : 1}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={forte ? '#2F6BFF' : '#94A3B8'}
                  strokeWidth={forte ? 2 : 1.2}
                  strokeDasharray={inferida ? '5 4' : undefined}
                  markerEnd={`url(#${forte ? 'pa-seta-forte' : 'pa-seta'})`}
                />
                {mostrarRotuloAresta && ((forte && rotularDestaque) || (!temDestaque && rotularTodas)) ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 4}
                    textAnchor="middle"
                    fontSize={9}
                    fill={forte ? '#1F56D9' : '#6B7A99'}
                    paintOrder="stroke"
                    stroke="#fff"
                    strokeWidth={3}
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {nodes.map((n) => {
            const p = positions.get(n.ref);
            if (!p) return null;
            const est = estiloDoNo(n);
            const selecionado = n.ref === selectedRef;
            const apagado = temDestaque && !destaqueNos.has(n.ref);
            const pendentes = n.expansions.reduce((s, x) => s + Math.max(x.total - x.loaded, 0), 0);

            return (
              <g
                key={n.ref}
                data-no={n.ref}
                transform={`translate(${p.x} ${p.y})`}
                opacity={apagado ? 0.28 : 1}
                role="button"
                tabIndex={0}
                aria-pressed={selecionado}
                aria-label={`${humanizarDatas(n.label)}${n.sublabel ? `, ${humanizarDatas(n.sublabel)}` : ''}. Pressione Enter para ver os detalhes.`}
                className="cursor-pointer outline-none"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(n.ref);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onSelect(n.ref);
                  }
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
              >
                {selecionado ? <circle r={est.raio + 7} fill="none" stroke="#2F6BFF" strokeWidth={2.5} /> : null}
                <circle r={est.raio} fill={est.fill} stroke={est.ring} strokeWidth={2} className="focus-visible:stroke-[4]" />
                <text textAnchor="middle" dy="0.35em" fontSize={est.raio > 18 ? 11 : 9} fontWeight={700} fill={n.kind === 'SIGNAL' && n.state === 'DESCONHECIDO' ? '#475569' : '#fff'}>
                  {est.sigla}
                </text>
                {pendentes > 0 ? (
                  <g transform={`translate(${est.raio * 0.72} ${-est.raio * 0.72})`} aria-hidden="true">
                    <circle r={8} fill="#14213D" />
                    <text textAnchor="middle" dy="0.35em" fontSize={8} fontWeight={700} fill="#fff">
                      {pendentes > 99 ? '99+' : pendentes}
                    </text>
                  </g>
                ) : null}
                <text
                  y={est.raio + 13}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={selecionado ? 700 : 500}
                  fill="#14213D"
                  paintOrder="stroke"
                  stroke="#fff"
                  strokeWidth={3.5}
                >
                  {rotuloCurto(humanizarDatas(n.label))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-card">
        <BotaoControle rotulo="Aproximar" onClick={() => setVista((v) => zoomEm(v, 1.2, tamanho.w / 2, tamanho.h / 2))}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </BotaoControle>
        <BotaoControle rotulo="Afastar" onClick={() => setVista((v) => zoomEm(v, 1 / 1.2, tamanho.w / 2, tamanho.h / 2))}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </BotaoControle>
        <BotaoControle rotulo="Enquadrar tudo" onClick={ajustar}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </BotaoControle>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 rounded-control bg-surface/90 px-2 py-1 text-[11px] text-muted">
        {Math.round(vista.scale * 100)}%
      </p>
    </div>
  );
}

function BotaoControle({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center text-navy-900 transition-colors',
        'hover:bg-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600',
        'border-b border-line last:border-b-0',
      )}
    >
      {children}
    </button>
  );
}
