import { describe, expect, it } from 'vitest';

import {
  EXPANDABLE_KINDS,
  GRAPH_LIMITS,
  GRAPH_NODE_KINDS,
  aplicarTeto,
  arestas,
  formatNodeRef,
  fundirGrafo,
  noLead,
  noPresence,
  noScore,
  noScoreReason,
  noSearch,
  noSignal,
  noNote,
  parseNodeRef,
  podeExpandir,
  vizinhosDiretos,
  type GraphNode,
  type LeadRow,
  type PresenceRow,
} from './intelligence-graph';

const lead: LeadRow = {
  id: 'cm0lead00000001',
  name: 'Clínica Alfa',
  category: 'Dentista',
  city: 'Campinas',
  stateUf: 'SP',
  websiteStatus: 'SEM_SITE',
  website: null,
  email: null,
  phone: '(19) 9****-1234',
  phoneIsMasked: true,
  reviewCount: 12,
  reviewRating: 4.6,
  isFavorite: false,
  isDisqualified: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  searchId: 'cm0search0000001',
};

const presenca: PresenceRow = {
  id: 'cm0presence00001',
  leadId: lead.id,
  hasWebsite: 'AUSENTE',
  hasEmail: 'DESCONHECIDO',
  hasPhone: 'PRESENTE',
  hasInstagram: 'DESCONHECIDO',
  hasFacebook: 'DESCONHECIDO',
  hasReviews: 'PRESENTE',
  websiteHasHttps: 'DESCONHECIDO',
  whatsappStatus: 'UNKNOWN',
  lastCheckedAt: null,
};

describe('parseNodeRef', () => {
  it('aceita tipo e id bem formados', () => {
    expect(parseNodeRef('LEAD:cm0lead00000001')).toEqual({ kind: 'LEAD', id: 'cm0lead00000001', field: null });
  });

  it('aceita sinal com campo conhecido', () => {
    expect(parseNodeRef('SIGNAL:cm0presence00001:hasInstagram')).toEqual({
      kind: 'SIGNAL',
      id: 'cm0presence00001',
      field: 'hasInstagram',
    });
  });

  it('recusa tipo desconhecido, id curto, caracteres de injecao e excesso de partes', () => {
    expect(parseNodeRef('TENANT:cm0lead00000001')).toBeNull();
    expect(parseNodeRef('LEAD:abc')).toBeNull();
    expect(parseNodeRef("LEAD:cm0lead0000001';--")).toBeNull();
    expect(parseNodeRef('LEAD:cm0lead00000001:extra')).toBeNull();
    expect(parseNodeRef('SIGNAL:cm0presence00001')).toBeNull();
    expect(parseNodeRef('SIGNAL:cm0presence00001:senha')).toBeNull();
    expect(parseNodeRef('')).toBeNull();
    expect(parseNodeRef('LEAD:' + 'a'.repeat(200))).toBeNull();
  });

  it('formatNodeRef e parseNodeRef sao inversos', () => {
    for (const kind of GRAPH_NODE_KINDS) {
      if (kind === 'SIGNAL') continue;
      const ref = formatNodeRef(kind, 'cm0qualquerid001');
      expect(parseNodeRef(ref)?.kind).toBe(kind);
    }
    expect(parseNodeRef(formatNodeRef('SIGNAL', 'cm0presence00001', 'hasEmail'))?.field).toBe('hasEmail');
  });
});

describe('expansao permitida', () => {
  it('so oferece o que o servidor aceita', () => {
    expect(podeExpandir('LEAD', 'NOTE')).toBe(true);
    expect(podeExpandir('LEAD', 'SCORE_REASON')).toBe(false);
    expect(podeExpandir('SCORE', 'SCORE_REASON')).toBe(true);
    expect(podeExpandir('SIGNAL', 'LEAD')).toBe(false);
    // nenhuma expansao leva a um tipo que ja e carregado na raiz por outra via
    for (const filhos of Object.values(EXPANDABLE_KINDS)) {
      expect(filhos?.includes('LEAD') && filhos.length > 1).toBe(false);
    }
  });
});

describe('construtores de no', () => {
  it('lead: telefone mascarado vem rotulado como mascarado', () => {
    const n = noLead(lead, 0, []);
    const tel = n.properties.find((p) => p.label.startsWith('Telefone'));
    expect(tel?.label).toBe('Telefone (mascarado pelo plano)');
    expect(tel?.value).toBe('(19) 9****-1234');
    expect(n.detailHref).toBe('/leads/cm0lead00000001');
  });

  it('lead: campo vazio e null, nunca texto inventado', () => {
    const n = noLead(lead, 0, []);
    expect(n.properties.find((p) => p.label === 'Site')?.value).toBeNull();
    expect(n.properties.find((p) => p.label === 'E-mail')?.value).toBeNull();
  });

  it('sinal: DESCONHECIDO continua DESCONHECIDO e explica que nao e ausencia', () => {
    const n = noSignal(presenca, 'hasInstagram', 2);
    expect(n.state).toBe('DESCONHECIDO');
    expect(n.properties.find((p) => p.label === 'Significado')?.value).toContain('não significa');
  });

  it('sinal: AUSENTE e PRESENTE so se o banco disse', () => {
    expect(noSignal(presenca, 'hasWebsite', 2).state).toBe('AUSENTE');
    expect(noSignal(presenca, 'hasPhone', 2).state).toBe('PRESENTE');
  });

  it('presenca: oferece exatamente os sete sinais', () => {
    expect(noPresence(presenca, 1, 0).expansions).toEqual([{ kind: 'SIGNAL', total: 7, loaded: 0 }]);
  });

  it('nota: recorta o texto longo e nao leva o conteudo inteiro', () => {
    const n = noNote({ id: 'cm0note00000001', leadId: lead.id, content: 'x'.repeat(500), createdAt: '2026-10-02T00:00:00.000Z' }, 1);
    const texto = n.properties.find((p) => p.label === 'Texto (recorte)')?.value ?? '';
    expect(texto.length).toBeLessThanOrEqual(140);
    expect(texto.endsWith('…')).toBe(true);
  });

  it('motivo do score: peso negativo aparece com sinal', () => {
    const n = noScoreReason(
      { id: 'cm0reason000001', scoreId: 'cm0score0000001', code: 'X', label: 'Sem site', weight: -5, polarity: 'ATENCAO', evidence: null },
      lead.id,
      2,
    );
    expect(n.sublabel).toBe('-5 · ATENCAO');
  });

  it('pesquisa: expande para leads com o total registrado', () => {
    const n = noSearch({ id: 'cm0search0000001', niche: 'Dentista', city: 'Campinas', stateUf: 'SP', leadsFound: 9, createdAt: '2026-10-01T00:00:00.000Z' }, 1, 9, 1);
    expect(n.expansions).toEqual([{ kind: 'LEAD', total: 9, loaded: 1 }]);
  });
});

describe('arestas', () => {
  it('toda aresta de 0.1.0 e verificada e traz a coluna que a comprova', () => {
    const lista = [
      arestas.pesquisaDoLead('LEAD:a', 'SEARCH:b'),
      arestas.scoreDoLead('LEAD:a', 'SCORE:b', '2026-10-01'),
      arestas.motivoDoScore('SCORE:b', 'SCORE_REASON:c', 5),
      arestas.presencaDoLead('LEAD:a', 'PRESENCE:b'),
      arestas.sinalDaPresenca('PRESENCE:b', 'SIGNAL:b:hasEmail', 'hasEmail'),
      arestas.auditoriaDoLead('LEAD:a', 'AUDIT:b', '2026-10-01'),
      arestas.checagemDaAuditoria('AUDIT:b', 'AUDIT_CHECK:c'),
      arestas.cartaoDoLead('LEAD:a', 'PIPELINE_CARD:b'),
      arestas.etapaDoCartao('PIPELINE_CARD:b', 'PIPELINE_STAGE:c'),
      arestas.atividadeDoLead('LEAD:a', 'ACTIVITY:b', '2026-10-01'),
      arestas.notaDoLead('LEAD:a', 'NOTE:b', '2026-10-01'),
      arestas.contatoDoLead('LEAD:a', 'CONTACT_RECORD:b', '2026-10-01'),
      arestas.followUpDoLead('LEAD:a', 'FOLLOW_UP:b', '2026-10-01'),
    ];
    for (const e of lista) {
      expect(e.verification).toBe('VERIFICADA');
      expect(e.provenance.ruleId).toBeNull();
      expect(e.provenance.kind === 'FOREIGN_KEY' || e.provenance.kind === 'SAME_ROW_FIELD').toBe(true);
      expect(e.provenance.source.length).toBeGreaterThan(5);
      expect(e.provenance.description.length).toBeGreaterThan(10);
    }
    expect(new Set(lista.map((e) => e.relation)).size).toBe(13);
  });

  it('id da aresta e estavel', () => {
    expect(arestas.notaDoLead('LEAD:a', 'NOTE:b', 'x').id).toBe('LEAD:a|HAS_NOTE|NOTE:b');
  });
});

describe('teto e fusao', () => {
  const nos = (n: number): GraphNode[] =>
    Array.from({ length: n }, (_, i) =>
      i === 0 ? noLead(lead, 0, []) : noNote({ id: `cm0note${String(i).padStart(8, '0')}`, leadId: lead.id, content: 'a', createdAt: '2026-10-02' }, 1),
    );

  it('aplicarTeto corta o excesso, conta por tipo e remove arestas orfas', () => {
    const lista = nos(10);
    const edges = lista.slice(1).map((n) => arestas.notaDoLead(lista[0]!.ref, n.ref, '2026-10-02'));
    const r = aplicarTeto(lista, edges, 4);
    expect(r.nodes).toHaveLength(4);
    expect(r.edges).toHaveLength(3);
    expect(r.cortados).toEqual({ NOTE: 6 });
  });

  it('aplicarTeto nao mexe quando cabe', () => {
    const lista = nos(3);
    expect(aplicarTeto(lista, [], 5).cortados).toEqual({});
  });

  it('fundirGrafo e idempotente e recalcula loaded', () => {
    const raiz = noLead(lead, 0, [{ kind: 'NOTE', total: 3, loaded: 0 }]);
    const notas = [1, 2].map((i) => noNote({ id: `cm0note${String(i).padStart(8, '0')}`, leadId: lead.id, content: 'a', createdAt: '2026-10-02' }, 1));
    const novas = { nodes: notas, edges: notas.map((n) => arestas.notaDoLead(raiz.ref, n.ref, '2026-10-02')) };
    const um = fundirGrafo({ nodes: [raiz], edges: [] }, novas);
    const dois = fundirGrafo(um, novas);
    expect(dois.nodes).toHaveLength(3);
    expect(dois.edges).toHaveLength(2);
    expect(dois.nodes.find((n) => n.kind === 'LEAD')?.expansions[0]?.loaded).toBe(2);
  });

  it('fundirGrafo descarta aresta cujo no nao esta no grafo', () => {
    const raiz = noLead(lead, 0, []);
    const solta = arestas.notaDoLead(raiz.ref, 'NOTE:inexistente', 'x');
    expect(fundirGrafo({ nodes: [raiz], edges: [] }, { nodes: [], edges: [solta] }).edges).toHaveLength(0);
  });

  it('vizinhosDiretos devolve so um salto, nos dois sentidos', () => {
    const e1 = arestas.scoreDoLead('LEAD:a', 'SCORE:b', 'x');
    const e2 = arestas.motivoDoScore('SCORE:b', 'SCORE_REASON:c', 1);
    const v = vizinhosDiretos([e1, e2], 'SCORE:b');
    expect([...v.nodes].sort()).toEqual(['LEAD:a', 'SCORE:b', 'SCORE_REASON:c']);
    const w = vizinhosDiretos([e1, e2], 'LEAD:a');
    expect([...w.nodes].sort()).toEqual(['LEAD:a', 'SCORE:b']);
  });
});

describe('limites tecnicos', () => {
  it('sao finitos e coerentes', () => {
    expect(GRAPH_LIMITS.defaultPageSize).toBeLessThanOrEqual(GRAPH_LIMITS.maxPageSize);
    expect(GRAPH_LIMITS.maxPageSize).toBeLessThanOrEqual(GRAPH_LIMITS.maxNodesPerResponse);
    expect(GRAPH_LIMITS.maxNodesPerResponse).toBeLessThanOrEqual(GRAPH_LIMITS.maxNodesOnCanvas);
  });

  it('noScore reflete a versao do algoritmo gravada', () => {
    const n = noScore({ id: 'cm0score0000001', leadId: lead.id, value: 72, level: 'ALTA', algorithmVersion: 'score-v1', calculatedAt: '2026-10-01' }, 1, 5, 0);
    expect(n.properties.find((p) => p.label === 'Versão do algoritmo')?.value).toBe('score-v1');
    expect(n.expansions[0]).toEqual({ kind: 'SCORE_REASON', total: 5, loaded: 0 });
  });
});
