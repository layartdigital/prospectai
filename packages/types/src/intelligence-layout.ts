import type { GraphEdge, GraphNode } from './intelligence-graph';

/**
 * Geometria do Intelligence Explorer: posicao dos nos e enquadramento.
 *
 * Fica em `@propectai/types` e nao em `apps/web` por um motivo pratico: e
 * calculo puro, sem DOM e sem React, e assim roda no teste de unidade sem
 * navegador. A interface so desenha o que esta funcao devolve.
 *
 * Nao e uma biblioteca de grafos nem uma copia de uma: e uma simulacao de forcas
 * pequena (repulsao entre nos, mola nas arestas, gravidade fraca ao centro),
 * deterministica — o mesmo grafo produz o mesmo desenho — porque um grafo que
 * muda de forma a cada abertura faz o usuario perder o lugar.
 */

export interface Ponto {
  x: number;
  y: number;
}

export interface OpcoesLayout {
  /** Posicoes ja existentes. Nos que estao aqui ficam onde estao. */
  fixos?: ReadonlyMap<string, Ponto>;
  iteracoes?: number;
  /** Distancia desejada entre no e vizinho. */
  mola?: number;
}

const RAIO_ANEL = 150;

/** Pseudo-aleatorio deterministico (mulberry32) a partir de uma string. */
function semente(texto: string): () => number {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calcula posicoes. A raiz (menor `depth`) nasce no centro; cada no novo nasce
 * perto do pai, em um anel proporcional a profundidade, e depois as forcas
 * acomodam. Nos de `fixos` nao se movem — expandir nao embaralha o que o
 * usuario ja estava olhando.
 */
export function calcularLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opcoes: OpcoesLayout = {},
): Map<string, Ponto> {
  const fixos = opcoes.fixos ?? new Map<string, Ponto>();
  const mola = opcoes.mola ?? RAIO_ANEL;
  const iteracoes = opcoes.iteracoes ?? 220;

  const pos = new Map<string, Ponto>();
  const pinned = new Set<string>();
  for (const n of nodes) {
    const f = fixos.get(n.ref);
    if (f) {
      pos.set(n.ref, { ...f });
      pinned.add(n.ref);
    }
  }

  // Pai = vizinho mais proximo da raiz, por busca em largura sem direcao. As
  // arestas nem sempre vao do pai ao filho (lead -> pesquisa), entao a origem
  // da aresta nao serve como pai.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const paiDe = new Map<string, string>();
  const raizes = [...nodes].sort((a, b) => a.depth - b.depth || a.ref.localeCompare(b.ref));
  const visitados = new Set<string>();
  for (const raiz of raizes) {
    if (visitados.has(raiz.ref)) continue;
    visitados.add(raiz.ref);
    const fila = [raiz.ref];
    while (fila.length > 0) {
      const atual = fila.shift() as string;
      for (const viz of (adj.get(atual) ?? []).slice().sort()) {
        if (visitados.has(viz)) continue;
        visitados.add(viz);
        paiDe.set(viz, atual);
        fila.push(viz);
      }
    }
  }

  const ordenados = [...nodes].sort((a, b) => a.depth - b.depth || a.ref.localeCompare(b.ref));
  const irmaosPorPai = new Map<string, number>();

  for (const n of ordenados) {
    if (pos.has(n.ref)) continue;
    const pai = paiDe.get(n.ref);
    const origem = (pai && pos.get(pai)) || { x: 0, y: 0 };
    const indice = irmaosPorPai.get(pai ?? '') ?? 0;
    irmaosPorPai.set(pai ?? '', indice + 1);

    if (!pai && pos.size === 0) {
      pos.set(n.ref, { x: 0, y: 0 });
      continue;
    }
    const rnd = semente(n.ref);
    const angulo = indice * 2.399963 + rnd() * 0.6; // angulo aureo: espalha sem sobrepor
    const raio = mola * (0.7 + rnd() * 0.5);
    pos.set(n.ref, { x: origem.x + Math.cos(angulo) * raio, y: origem.y + Math.sin(angulo) * raio });
  }

  const refs = nodes.map((n) => n.ref);
  const vel = new Map<string, Ponto>(refs.map((r) => [r, { x: 0, y: 0 }]));
  const ligacoes = edges.filter((e) => pos.has(e.source) && pos.has(e.target));

  for (let it = 0; it < iteracoes; it++) {
    const resfriamento = 1 - it / iteracoes;
    const forca = new Map<string, Ponto>(refs.map((r) => [r, { x: 0, y: 0 }]));

    // repulsao entre todos os pares (n <= teto da tela, entao O(n^2) e aceitavel)
    for (let i = 0; i < refs.length; i++) {
      const a = refs[i] as string;
      const pa = pos.get(a) as Ponto;
      for (let j = i + 1; j < refs.length; j++) {
        const b = refs[j] as string;
        const pb = pos.get(b) as Ponto;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (j % 2 ? 1 : -1) * 0.1;
          dy = 0.1;
          d2 = 0.02;
        }
        const d = Math.sqrt(d2);
        const f = (mola * mola * 0.9) / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fa = forca.get(a) as Ponto;
        const fb = forca.get(b) as Ponto;
        fa.x += fx;
        fa.y += fy;
        fb.x -= fx;
        fb.y -= fy;
      }
    }

    // mola nas arestas
    for (const e of ligacoes) {
      const pa = pos.get(e.source) as Ponto;
      const pb = pos.get(e.target) as Ponto;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - mola) * 0.06;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fa = forca.get(e.source) as Ponto;
      const fb = forca.get(e.target) as Ponto;
      fa.x += fx;
      fa.y += fy;
      fb.x -= fx;
      fb.y -= fy;
    }

    // gravidade fraca ao centro: impede que componentes se afastem sem limite
    for (const r of refs) {
      const p = pos.get(r) as Ponto;
      const f = forca.get(r) as Ponto;
      f.x -= p.x * 0.004;
      f.y -= p.y * 0.004;
    }

    for (const r of refs) {
      if (pinned.has(r)) continue;
      const v = vel.get(r) as Ponto;
      const f = forca.get(r) as Ponto;
      v.x = (v.x + f.x) * 0.55;
      v.y = (v.y + f.y) * 0.55;
      const passo = 18 * resfriamento + 2;
      const modulo = Math.hypot(v.x, v.y);
      const k = modulo > passo ? passo / modulo : 1;
      const p = pos.get(r) as Ponto;
      p.x += v.x * k;
      p.y += v.y * k;
    }
  }

  return pos;
}

export interface Enquadramento {
  scale: number;
  tx: number;
  ty: number;
}

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;

export function limitarZoom(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** Enquadra todos os pontos na area `largura x altura`, com margem. */
export function ajustarVisualizacao(
  pontos: Iterable<Ponto>,
  largura: number,
  altura: number,
  margem = 56,
): Enquadramento {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pontos) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX) || largura <= 0 || altura <= 0) return { scale: 1, tx: largura / 2, ty: altura / 2 };

  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const scale = limitarZoom(Math.min((largura - margem * 2) / w, (altura - margem * 2) / h, 1.4));
  return {
    scale,
    tx: largura / 2 - ((minX + maxX) / 2) * scale,
    ty: altura / 2 - ((minY + maxY) / 2) * scale,
  };
}

/** Zoom mantendo fixo o ponto da tela (`cx`, `cy`) — o comportamento esperado da roda. */
export function zoomEm(
  atual: Enquadramento,
  fator: number,
  cx: number,
  cy: number,
): Enquadramento {
  const scale = limitarZoom(atual.scale * fator);
  const k = scale / atual.scale;
  return { scale, tx: cx - (cx - atual.tx) * k, ty: cy - (cy - atual.ty) * k };
}
