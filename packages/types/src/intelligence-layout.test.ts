import { describe, expect, it } from 'vitest';

import { ajustarVisualizacao, calcularLayout, limitarZoom, zoomEm, ZOOM_MAX, ZOOM_MIN } from './intelligence-layout';
import { arestas, noLead, noNote, type GraphNode, type LeadRow } from './intelligence-graph';

const lead: LeadRow = {
  id: 'cm0lead00000001', name: 'A', category: null, city: null, stateUf: null, websiteStatus: 'SEM_SITE', website: null,
  email: null, phone: null, phoneIsMasked: false, reviewCount: null, reviewRating: null, isFavorite: false,
  isDisqualified: false, createdAt: '2026-10-01', searchId: null,
};

function grafo(n: number): { nodes: GraphNode[]; edges: ReturnType<typeof arestas.notaDoLead>[] } {
  const raiz = noLead(lead, 0, []);
  const filhos = Array.from({ length: n }, (_, i) =>
    noNote({ id: `cm0note${String(i).padStart(8, '0')}`, leadId: lead.id, content: 'a', createdAt: '2026-10-02' }, 1),
  );
  return { nodes: [raiz, ...filhos], edges: filhos.map((f) => arestas.notaDoLead(raiz.ref, f.ref, '2026-10-02')) };
}

describe('calcularLayout', () => {
  it('e deterministico', () => {
    const g = grafo(8);
    const a = calcularLayout(g.nodes, g.edges);
    const b = calcularLayout(g.nodes, g.edges);
    for (const n of g.nodes) expect(a.get(n.ref)).toEqual(b.get(n.ref));
  });

  it('da posicao finita a todos os nos e nao deixa dois no mesmo ponto', () => {
    const g = grafo(20);
    const p = calcularLayout(g.nodes, g.edges);
    expect(p.size).toBe(21);
    const vistos = new Set<string>();
    for (const n of g.nodes) {
      const q = p.get(n.ref)!;
      expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      vistos.add(`${Math.round(q.x / 4)}:${Math.round(q.y / 4)}`);
    }
    expect(vistos.size).toBe(21);
  });

  it('mantem a distancia minima entre nos (sem sobreposicao de circulos de 22px)', () => {
    const g = grafo(24);
    const p = calcularLayout(g.nodes, g.edges);
    const lista = g.nodes.map((n) => p.get(n.ref)!);
    let menor = Infinity;
    for (let i = 0; i < lista.length; i++)
      for (let j = i + 1; j < lista.length; j++) menor = Math.min(menor, Math.hypot(lista[i]!.x - lista[j]!.x, lista[i]!.y - lista[j]!.y));
    expect(menor).toBeGreaterThan(44);
  });

  it('nos fixos nao se movem ao expandir', () => {
    const g = grafo(3);
    const antes = calcularLayout(g.nodes, g.edges);
    const g2 = grafo(7);
    const depois = calcularLayout(g2.nodes, g2.edges, { fixos: antes });
    for (const n of g.nodes) expect(depois.get(n.ref)).toEqual(antes.get(n.ref));
    expect(depois.size).toBe(8);
  });

  it('grafo vazio e de um no nao quebram', () => {
    expect(calcularLayout([], []).size).toBe(0);
    const um = grafo(0);
    expect(calcularLayout(um.nodes, um.edges).get(um.nodes[0]!.ref)).toEqual({ x: 0, y: 0 });
  });
});

describe('enquadramento e zoom', () => {
  it('ajustarVisualizacao centraliza e respeita o limite de zoom', () => {
    const e = ajustarVisualizacao([{ x: -100, y: -50 }, { x: 100, y: 50 }], 800, 600);
    expect(e.scale).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(e.scale).toBeLessThanOrEqual(ZOOM_MAX);
    // o centro do conteudo cai no centro da area
    expect(0 * e.scale + e.tx).toBeCloseTo(400, 5);
    expect(0 * e.scale + e.ty).toBeCloseTo(300, 5);
  });

  it('sem pontos, devolve enquadramento neutro no centro', () => {
    expect(ajustarVisualizacao([], 800, 600)).toEqual({ scale: 1, tx: 400, ty: 300 });
  });

  it('zoomEm mantem o ponto sob o cursor', () => {
    const e0 = { scale: 1, tx: 10, ty: 20 };
    const e1 = zoomEm(e0, 1.5, 300, 200);
    const mundoAntes = { x: (300 - e0.tx) / e0.scale, y: (200 - e0.ty) / e0.scale };
    const mundoDepois = { x: (300 - e1.tx) / e1.scale, y: (200 - e1.ty) / e1.scale };
    expect(mundoDepois.x).toBeCloseTo(mundoAntes.x, 6);
    expect(mundoDepois.y).toBeCloseTo(mundoAntes.y, 6);
  });

  it('limitarZoom trava nos extremos', () => {
    expect(limitarZoom(100)).toBe(ZOOM_MAX);
    expect(limitarZoom(0.0001)).toBe(ZOOM_MIN);
  });
});
