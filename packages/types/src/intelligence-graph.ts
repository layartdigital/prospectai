import type { SignalState } from './common';

/**
 * Contrato do Intelligence Explorer (Prompt 04, incremento 0.1.0).
 *
 * Este arquivo e puro: sem Prisma, sem Nest, sem React. Ele define o que a API
 * devolve, os tetos que o servidor impoe e o construtor que transforma linhas
 * ja lidas do banco em nos e arestas. A leitura em si (e o tenant) vive em
 * `apps/api/src/intelligence`; o desenho vive em `apps/web`.
 *
 * ---------------------------------------------------------------------------
 * Regra de verdade do grafo
 * ---------------------------------------------------------------------------
 *
 * So existe aresta onde existe **chave estrangeira** no schema (ou um campo da
 * mesma linha, no caso dos sinais de presenca digital). Nada e ligado por
 * "mesma cidade" ou "mesmo segmento". A coluna `verification` existe para que
 * uma regra de inferencia futura entre **marcada como inferencia**, mas o
 * incremento 0.1.0 nao define nenhuma: toda aresta devolvida hoje e
 * `VERIFICADA`.
 *
 * Ausencia de sinal e `DESCONHECIDO`, nunca `AUSENTE` (CLAUDE.md, regra 4): o
 * construtor copia o estado do banco e nao o reinterpreta.
 */

export const INTELLIGENCE_MODULE_NAME = 'Intelligence Explorer';
/** Versao do modulo. Nao e a versao do produto (0.1.1). */
export const INTELLIGENCE_MODULE_VERSION = '0.1.0';
/** Incremento entregue pelo Prompt 04 v1.0.0. */
export const INTELLIGENCE_INCREMENT = 'P04-I1';

/**
 * Tetos tecnicos. **Nao sao limites comerciais.**
 *
 * Existem para impedir que uma requisicao devolva a base inteira e para manter
 * o grafo legivel. Nenhum valor aqui e preco, cota ou diferenciacao de plano:
 * quando o proprietario decidir dimensoes por plano (investigacoes, profundidade,
 * creditos de IA), o ponto de integracao e `IntelligenceService.limitesDoPlano`.
 */
export const GRAPH_LIMITS = {
  /** Maximo de nos em qualquer resposta (grafo inicial ou expansao). */
  maxNodesPerResponse: 60,
  /** Quantos filhos de um tipo uma expansao devolve se o cliente nao pedir. */
  defaultPageSize: 8,
  /** Maximo que o cliente pode pedir por pagina de expansao. */
  maxPageSize: 25,
  /** Profundidade maxima a partir da raiz (raiz = 0). */
  maxDepth: 3,
  /** Maximo de nos que a tela mantem no grafo antes de pedir para recolher. */
  maxNodesOnCanvas: 150,
} as const;

export type GraphLimits = { -readonly [K in keyof typeof GRAPH_LIMITS]: number };

export const GRAPH_NODE_KINDS = [
  'LEAD',
  'SEARCH',
  'SCORE',
  'SCORE_REASON',
  'PRESENCE',
  'SIGNAL',
  'AUDIT',
  'AUDIT_CHECK',
  'PIPELINE_CARD',
  'PIPELINE_STAGE',
  'ACTIVITY',
  'NOTE',
  'CONTACT_RECORD',
  'FOLLOW_UP',
] as const;

export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

/** Rotulo em portugues para filtros e legenda. */
export const GRAPH_NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  LEAD: 'Lead',
  SEARCH: 'Pesquisa',
  SCORE: 'Score',
  SCORE_REASON: 'Motivo do score',
  PRESENCE: 'Presença digital',
  SIGNAL: 'Sinal',
  AUDIT: 'Auditoria',
  AUDIT_CHECK: 'Verificação',
  PIPELINE_CARD: 'Cartão no pipeline',
  PIPELINE_STAGE: 'Etapa comercial',
  ACTIVITY: 'Atividade',
  NOTE: 'Nota',
  CONTACT_RECORD: 'Contato registrado',
  FOLLOW_UP: 'Follow-up',
};

export const GRAPH_RELATIONS = [
  'FOUND_BY_SEARCH',
  'HAS_SCORE',
  'EXPLAINED_BY',
  'HAS_PRESENCE',
  'PRESENCE_SIGNAL',
  'AUDITED_BY',
  'CHECKED',
  'IN_PIPELINE',
  'AT_STAGE',
  'HAS_ACTIVITY',
  'HAS_NOTE',
  'HAS_CONTACT',
  'HAS_FOLLOW_UP',
] as const;

export type GraphRelation = (typeof GRAPH_RELATIONS)[number];

export const GRAPH_RELATION_LABELS: Record<GraphRelation, string> = {
  FOUND_BY_SEARCH: 'encontrado pela pesquisa',
  HAS_SCORE: 'tem score',
  EXPLAINED_BY: 'explicado por',
  HAS_PRESENCE: 'tem presença digital',
  PRESENCE_SIGNAL: 'sinal de presença',
  AUDITED_BY: 'auditado em',
  CHECKED: 'verificou',
  IN_PIPELINE: 'está no pipeline',
  AT_STAGE: 'na etapa',
  HAS_ACTIVITY: 'registrou atividade',
  HAS_NOTE: 'tem nota',
  HAS_CONTACT: 'tem contato registrado',
  HAS_FOLLOW_UP: 'tem follow-up',
};

/**
 * Como a aresta foi comprovada.
 *
 * - `FOREIGN_KEY`: a ligacao e uma FK do schema (`leads.searchId`, ...).
 * - `SAME_ROW_FIELD`: o no filho e um campo da propria linha pai (sinais da
 *   presenca digital). Nao ha segunda tabela; ha leitura direta de coluna.
 * - `INFERENCE_RULE`: regra explicita e documentada. **Nenhuma existe em 0.1.0.**
 */
export type GraphProvenanceKind = 'FOREIGN_KEY' | 'SAME_ROW_FIELD' | 'INFERENCE_RULE';

export type GraphVerification = 'VERIFICADA' | 'INFERIDA';

export interface GraphProvenance {
  kind: GraphProvenanceKind;
  /** Tabela.coluna que comprova, ex.: `leads.searchId`. */
  source: string;
  /** So para inferencia: identificador da regra documentada. */
  ruleId: string | null;
  /** Frase que o usuario le no painel para entender a origem. */
  description: string;
}

export interface GraphProperty {
  label: string;
  /** Texto ja formatado e autorizado. `null` significa "nao informado". */
  value: string | null;
}

/** Filhos que o usuario pode pedir a partir de um no. */
export interface GraphExpansionOption {
  kind: GraphNodeKind;
  /** Total existente no banco para este tenant (respeita soft delete). */
  total: number;
  /** Quantos ja estao no grafo enviado. */
  loaded: number;
}

export interface GraphNode {
  /** `KIND:id` (ou `SIGNAL:leadId:campo`). Estavel entre chamadas. */
  ref: string;
  kind: GraphNodeKind;
  label: string;
  sublabel: string | null;
  /** Estado de sinal, quando o no representa um sinal. */
  state: SignalState | null;
  /** Distancia da raiz no grafo montado (raiz = 0). */
  depth: number;
  properties: GraphProperty[];
  /** Rota da aplicacao que abre o recurso original, quando existe. */
  detailHref: string | null;
  expansions: GraphExpansionOption[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  label: string;
  verification: GraphVerification;
  provenance: GraphProvenance;
  /** Metadados permitidos (datas, pesos). Nunca conteudo bruto de terceiros. */
  metadata: GraphProperty[];
}

export interface GraphResponse {
  rootRef: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Quantos itens deixaram de vir por causa dos tetos, por tipo. */
  omitted: Partial<Record<GraphNodeKind, number>>;
  limits: GraphLimits;
  moduleVersion: string;
  increment: string;
  generatedAt: string;
}

export interface GraphExpandResponse extends GraphResponse {
  /** Tipo expandido e proxima posicao, ou `null` quando nao ha mais. */
  expanded: { ref: string; kind: GraphNodeKind; nextOffset: number | null };
}

// ---------------------------------------------------------------------------
// Referencias de no
// ---------------------------------------------------------------------------

/** cuid do Prisma e alfanumerico minusculo; aceita folga para outros formatos. */
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const SIGNAL_FIELDS = [
  'hasWebsite',
  'hasEmail',
  'hasPhone',
  'hasInstagram',
  'hasFacebook',
  'hasReviews',
  'websiteHasHttps',
] as const;

export type SignalField = (typeof SIGNAL_FIELDS)[number];

export const SIGNAL_LABELS: Record<SignalField, string> = {
  hasWebsite: 'Site',
  hasEmail: 'E-mail',
  hasPhone: 'Telefone',
  hasInstagram: 'Instagram',
  hasFacebook: 'Facebook',
  hasReviews: 'Avaliações',
  websiteHasHttps: 'HTTPS (inferido da URL)',
};

export interface ParsedNodeRef {
  kind: GraphNodeKind;
  id: string;
  /** Preenchido so para `SIGNAL`. */
  field: SignalField | null;
}

export function formatNodeRef(kind: GraphNodeKind, id: string, field?: SignalField): string {
  return kind === 'SIGNAL' && field ? `SIGNAL:${id}:${field}` : `${kind}:${id}`;
}

/**
 * Valida uma referencia vinda do cliente. **Devolve `null` em vez de lancar**:
 * quem chama decide o status HTTP, e referencia malformada e 400, nao 500.
 *
 * Nao consulta o banco e nao prova que o id existe nem que e do tenant — isso
 * e papel da consulta com RLS. Aqui so se garante que a string e do formato
 * esperado e nao carrega nada alem de tipo e id.
 */
export function parseNodeRef(ref: string): ParsedNodeRef | null {
  if (typeof ref !== 'string' || ref.length > 120) return null;

  const partes = ref.split(':');
  const [kind, id, field] = partes;
  if (!kind || !id) return null;
  if (!(GRAPH_NODE_KINDS as readonly string[]).includes(kind)) return null;
  if (!ID_PATTERN.test(id)) return null;

  if (kind === 'SIGNAL') {
    if (partes.length !== 3) return null;
    if (!(SIGNAL_FIELDS as readonly string[]).includes(field ?? '')) return null;
    return { kind: 'SIGNAL', id, field: field as SignalField };
  }

  if (partes.length !== 2) return null;
  return { kind: kind as GraphNodeKind, id, field: null };
}

/**
 * Tipos que cada tipo de no sabe expandir. Fonte unica para API e interface:
 * a tela so oferece o botao que o servidor aceita.
 */
export const EXPANDABLE_KINDS: Partial<Record<GraphNodeKind, readonly GraphNodeKind[]>> = {
  LEAD: [
    'SEARCH',
    'SCORE',
    'PRESENCE',
    'PIPELINE_CARD',
    'AUDIT',
    'ACTIVITY',
    'NOTE',
    'CONTACT_RECORD',
    'FOLLOW_UP',
  ],
  SEARCH: ['LEAD'],
  SCORE: ['SCORE_REASON'],
  PRESENCE: ['SIGNAL'],
  AUDIT: ['AUDIT_CHECK'],
  PIPELINE_CARD: ['PIPELINE_STAGE'],
};

export function podeExpandir(parent: GraphNodeKind, filho: GraphNodeKind): boolean {
  return EXPANDABLE_KINDS[parent]?.includes(filho) ?? false;
}

// ---------------------------------------------------------------------------
// Linhas de entrada do construtor (o que o servico le do banco)
// ---------------------------------------------------------------------------

type Data = string; // ISO 8601, ja serializada pelo servico

export interface LeadRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  stateUf: string | null;
  websiteStatus: string;
  website: string | null;
  email: string | null;
  /** Ja mascarado pelo servidor conforme o plano. */
  phone: string | null;
  phoneIsMasked: boolean;
  reviewCount: number | null;
  reviewRating: number | null;
  isFavorite: boolean;
  isDisqualified: boolean;
  createdAt: Data;
  searchId: string | null;
}

export interface SearchRow {
  id: string;
  niche: string;
  city: string;
  stateUf: string;
  leadsFound: number;
  createdAt: Data;
}

export interface ScoreRow {
  id: string;
  leadId: string;
  value: number;
  level: string;
  algorithmVersion: string;
  calculatedAt: Data;
}

export interface ScoreReasonRow {
  id: string;
  scoreId: string;
  code: string;
  label: string;
  weight: number;
  polarity: string;
  evidence: string | null;
}

export interface PresenceRow {
  id: string;
  leadId: string;
  hasWebsite: SignalState;
  hasEmail: SignalState;
  hasPhone: SignalState;
  hasInstagram: SignalState;
  hasFacebook: SignalState;
  hasReviews: SignalState;
  websiteHasHttps: SignalState;
  whatsappStatus: string;
  lastCheckedAt: Data | null;
}

export interface AuditRow {
  id: string;
  leadId: string;
  status: string;
  auditVersion: string;
  createdAt: Data;
  finishedAt: Data | null;
}

export interface AuditCheckRow {
  id: string;
  auditId: string;
  check: string;
  outcome: string;
  observedAt: Data | null;
  confidence: number | null;
}

export interface PipelineCardRow {
  id: string;
  leadId: string;
  stageId: string;
  enteredStageAt: Data;
  estimatedValue: number | null;
}

export interface PipelineStageRow {
  id: string;
  name: string;
  slug: string;
  order: number;
  isTerminal: boolean;
  isWon: boolean;
}

export interface ActivityRow {
  id: string;
  leadId: string;
  type: string;
  createdAt: Data;
}

export interface NoteRow {
  id: string;
  leadId: string;
  /** Texto bruto; o construtor aplica o recorte. */
  content: string;
  createdAt: Data;
}

export interface ContactRow {
  id: string;
  leadId: string;
  channel: string;
  direction: string;
  outcome: string | null;
  occurredAt: Data;
}

export interface FollowUpRow {
  id: string;
  leadId: string;
  channel: string;
  priority: string;
  status: string;
  dueAt: Data;
}

// ---------------------------------------------------------------------------
// Construtor
// ---------------------------------------------------------------------------

const NOTE_PREVIEW_CHARS = 140;
const EVIDENCE_PREVIEW_CHARS = 200;

function recortar(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

function prop(label: string, value: string | number | boolean | null | undefined): GraphProperty {
  if (value === null || value === undefined || value === '') return { label, value: null };
  if (typeof value === 'boolean') return { label, value: value ? 'Sim' : 'Não' };
  return { label, value: String(value) };
}

function fk(source: string, description: string): GraphProvenance {
  return { kind: 'FOREIGN_KEY', source, ruleId: null, description };
}

export function edgeId(source: string, relation: GraphRelation, target: string): string {
  return `${source}|${relation}|${target}`;
}

function aresta(
  source: string,
  target: string,
  relation: GraphRelation,
  provenance: GraphProvenance,
  metadata: GraphProperty[] = [],
): GraphEdge {
  return {
    id: edgeId(source, relation, target),
    source,
    target,
    relation,
    label: GRAPH_RELATION_LABELS[relation],
    verification: 'VERIFICADA',
    provenance,
    metadata,
  };
}

function expansao(kind: GraphNodeKind, total: number, loaded: number): GraphExpansionOption {
  return { kind, total, loaded };
}

export function noLead(row: LeadRow, depth: number, expansions: GraphExpansionOption[]): GraphNode {
  return {
    ref: formatNodeRef('LEAD', row.id),
    kind: 'LEAD',
    label: row.name,
    sublabel: [row.category, row.city && row.stateUf ? `${row.city}/${row.stateUf}` : row.city]
      .filter(Boolean)
      .join(' · ') || null,
    state: null,
    depth,
    properties: [
      prop('Categoria', row.category),
      prop('Cidade', row.city),
      prop('UF', row.stateUf),
      prop('Situação do site', row.websiteStatus),
      prop('Site', row.website),
      prop('E-mail', row.email),
      prop(row.phoneIsMasked ? 'Telefone (mascarado pelo plano)' : 'Telefone', row.phone),
      prop('Avaliações', row.reviewCount),
      prop('Nota média', row.reviewRating),
      prop('Favorito', row.isFavorite),
      prop('Desqualificado', row.isDisqualified),
      prop('Criado em', row.createdAt),
    ],
    detailHref: `/leads/${row.id}`,
    expansions,
  };
}

export function noSearch(row: SearchRow, depth: number, leadsInSearch: number, loaded: number): GraphNode {
  return {
    ref: formatNodeRef('SEARCH', row.id),
    kind: 'SEARCH',
    label: row.niche,
    sublabel: `${row.city}/${row.stateUf}`,
    state: null,
    depth,
    properties: [
      prop('Nicho', row.niche),
      prop('Cidade', row.city),
      prop('UF', row.stateUf),
      prop('Leads encontrados (registrado na pesquisa)', row.leadsFound),
      prop('Realizada em', row.createdAt),
    ],
    detailHref: '/history',
    expansions: [expansao('LEAD', leadsInSearch, loaded)],
  };
}

export function noScore(row: ScoreRow, depth: number, reasonsTotal: number, loaded: number): GraphNode {
  return {
    ref: formatNodeRef('SCORE', row.id),
    kind: 'SCORE',
    label: `Score ${row.value}`,
    sublabel: row.level,
    state: null,
    depth,
    properties: [
      prop('Valor', row.value),
      prop('Nível', row.level),
      prop('Versão do algoritmo', row.algorithmVersion),
      prop('Calculado em', row.calculatedAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [expansao('SCORE_REASON', reasonsTotal, loaded)],
  };
}

export function noScoreReason(row: ScoreReasonRow, leadId: string, depth: number): GraphNode {
  const sinal = row.weight > 0 ? `+${row.weight}` : String(row.weight);
  return {
    ref: formatNodeRef('SCORE_REASON', row.id),
    kind: 'SCORE_REASON',
    label: row.label,
    sublabel: `${sinal} · ${row.polarity}`,
    state: null,
    depth,
    properties: [
      prop('Código', row.code),
      prop('Peso', row.weight),
      prop('Polaridade', row.polarity),
      prop('Evidência registrada', row.evidence ? recortar(row.evidence, EVIDENCE_PREVIEW_CHARS) : null),
    ],
    detailHref: `/leads/${leadId}`,
    expansions: [],
  };
}

export function noPresence(row: PresenceRow, depth: number, loadedSignals: number): GraphNode {
  return {
    ref: formatNodeRef('PRESENCE', row.id),
    kind: 'PRESENCE',
    label: 'Presença digital',
    sublabel: row.lastCheckedAt ? `verificada em ${row.lastCheckedAt}` : 'sem verificação registrada',
    state: null,
    depth,
    properties: [
      prop('WhatsApp', row.whatsappStatus),
      prop('Última verificação', row.lastCheckedAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [expansao('SIGNAL', SIGNAL_FIELDS.length, loadedSignals)],
  };
}

export function noSignal(row: PresenceRow, field: SignalField, depth: number): GraphNode {
  const estado = row[field];
  return {
    ref: formatNodeRef('SIGNAL', row.id, field),
    kind: 'SIGNAL',
    label: SIGNAL_LABELS[field],
    sublabel: estado,
    state: estado,
    depth,
    properties: [
      prop('Estado', estado),
      prop(
        'Significado',
        estado === 'DESCONHECIDO'
          ? 'Não verificado. Isso não significa que o sinal não exista.'
          : estado === 'PRESENTE'
            ? 'Verificado como presente.'
            : 'Verificado como ausente.',
      ),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [],
  };
}

export function noAudit(row: AuditRow, depth: number, checksTotal: number, loaded: number): GraphNode {
  return {
    ref: formatNodeRef('AUDIT', row.id),
    kind: 'AUDIT',
    label: 'Auditoria de presença digital',
    sublabel: `${row.status} · ${row.createdAt}`,
    state: null,
    depth,
    properties: [
      prop('Situação', row.status),
      prop('Versão da auditoria', row.auditVersion),
      prop('Solicitada em', row.createdAt),
      prop('Concluída em', row.finishedAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [expansao('AUDIT_CHECK', checksTotal, loaded)],
  };
}

export function noAuditCheck(row: AuditCheckRow, leadId: string, depth: number): GraphNode {
  return {
    ref: formatNodeRef('AUDIT_CHECK', row.id),
    kind: 'AUDIT_CHECK',
    label: row.check,
    sublabel: row.outcome,
    state: null,
    depth,
    properties: [
      prop('Verificação', row.check),
      prop('Resultado', row.outcome),
      prop('Observada em', row.observedAt),
      prop('Confiança', row.confidence),
    ],
    detailHref: `/leads/${leadId}`,
    expansions: [],
  };
}

export function noPipelineCard(row: PipelineCardRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('PIPELINE_CARD', row.id),
    kind: 'PIPELINE_CARD',
    label: 'Cartão no pipeline',
    sublabel: `na etapa desde ${row.enteredStageAt}`,
    state: null,
    depth,
    properties: [
      prop('Na etapa desde', row.enteredStageAt),
      prop('Valor estimado', row.estimatedValue),
    ],
    detailHref: '/pipeline',
    expansions: [expansao('PIPELINE_STAGE', 1, 0)],
  };
}

export function noPipelineStage(row: PipelineStageRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('PIPELINE_STAGE', row.id),
    kind: 'PIPELINE_STAGE',
    label: row.name,
    sublabel: row.isTerminal ? (row.isWon ? 'etapa final · ganho' : 'etapa final') : `etapa ${row.order}`,
    state: null,
    depth,
    properties: [
      prop('Etapa', row.name),
      prop('Posição', row.order),
      prop('Final', row.isTerminal),
      prop('Ganho', row.isWon),
    ],
    detailHref: '/pipeline',
    expansions: [],
  };
}

export function noActivity(row: ActivityRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('ACTIVITY', row.id),
    kind: 'ACTIVITY',
    label: row.type,
    sublabel: row.createdAt,
    state: null,
    depth,
    properties: [prop('Tipo', row.type), prop('Registrada em', row.createdAt)],
    detailHref: `/leads/${row.leadId}`,
    expansions: [],
  };
}

export function noNote(row: NoteRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('NOTE', row.id),
    kind: 'NOTE',
    label: 'Nota',
    sublabel: row.createdAt,
    state: null,
    depth,
    properties: [
      prop('Texto (recorte)', recortar(row.content, NOTE_PREVIEW_CHARS)),
      prop('Criada em', row.createdAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [],
  };
}

export function noContact(row: ContactRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('CONTACT_RECORD', row.id),
    kind: 'CONTACT_RECORD',
    label: `${row.channel} · ${row.direction}`,
    sublabel: row.occurredAt,
    state: null,
    depth,
    properties: [
      prop('Canal', row.channel),
      prop('Direção', row.direction),
      prop('Resultado', row.outcome),
      prop('Ocorrido em', row.occurredAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [],
  };
}

export function noFollowUp(row: FollowUpRow, depth: number): GraphNode {
  return {
    ref: formatNodeRef('FOLLOW_UP', row.id),
    kind: 'FOLLOW_UP',
    label: `Follow-up · ${row.status}`,
    sublabel: row.dueAt,
    state: null,
    depth,
    properties: [
      prop('Situação', row.status),
      prop('Prioridade', row.priority),
      prop('Canal', row.channel),
      prop('Previsto para', row.dueAt),
    ],
    detailHref: `/leads/${row.leadId}`,
    expansions: [],
  };
}

// Arestas por relacao --------------------------------------------------------

export const arestas = {
  pesquisaDoLead(leadRef: string, searchRef: string): GraphEdge {
    return aresta(
      leadRef,
      searchRef,
      'FOUND_BY_SEARCH',
      fk('leads.searchId → prospecting_searches.id', 'O lead guarda o identificador da pesquisa que o encontrou.'),
    );
  },
  scoreDoLead(leadRef: string, scoreRef: string, calculatedAt: string): GraphEdge {
    return aresta(
      leadRef,
      scoreRef,
      'HAS_SCORE',
      fk('lead_scores.leadId → leads.id', 'O score pertence a este lead (um por lead).'),
      [prop('Calculado em', calculatedAt)],
    );
  },
  motivoDoScore(scoreRef: string, reasonRef: string, weight: number): GraphEdge {
    return aresta(
      scoreRef,
      reasonRef,
      'EXPLAINED_BY',
      fk('lead_score_reasons.scoreId → lead_scores.id', 'O motivo foi gravado pelo motor de score junto com este valor.'),
      [prop('Peso', weight)],
    );
  },
  presencaDoLead(leadRef: string, presenceRef: string): GraphEdge {
    return aresta(
      leadRef,
      presenceRef,
      'HAS_PRESENCE',
      fk('lead_digital_presences.leadId → leads.id', 'A presença digital pertence a este lead (uma por lead).'),
    );
  },
  sinalDaPresenca(presenceRef: string, signalRef: string, field: SignalField): GraphEdge {
    return {
      ...aresta(presenceRef, signalRef, 'PRESENCE_SIGNAL', {
        kind: 'SAME_ROW_FIELD',
        source: `lead_digital_presences.${field}`,
        ruleId: null,
        description: 'O sinal é uma coluna da própria linha de presença digital. O estado é copiado do banco, sem reinterpretação.',
      }),
    };
  },
  auditoriaDoLead(leadRef: string, auditRef: string, createdAt: string): GraphEdge {
    return aresta(
      leadRef,
      auditRef,
      'AUDITED_BY',
      fk('digital_presence_audits.leadId → leads.id', 'A auditoria foi solicitada para este lead.'),
      [prop('Solicitada em', createdAt)],
    );
  },
  checagemDaAuditoria(auditRef: string, checkRef: string): GraphEdge {
    return aresta(
      auditRef,
      checkRef,
      'CHECKED',
      fk('digital_presence_checks.auditId → digital_presence_audits.id', 'A verificação foi executada dentro desta auditoria.'),
    );
  },
  cartaoDoLead(leadRef: string, cardRef: string): GraphEdge {
    return aresta(
      leadRef,
      cardRef,
      'IN_PIPELINE',
      fk('pipeline_cards.leadId → leads.id', 'O lead tem um cartão no pipeline (um por lead).'),
    );
  },
  etapaDoCartao(cardRef: string, stageRef: string): GraphEdge {
    return aresta(
      cardRef,
      stageRef,
      'AT_STAGE',
      fk('pipeline_cards.stageId → pipeline_stages.id', 'O cartão está nesta etapa do funil.'),
    );
  },
  atividadeDoLead(leadRef: string, ref: string, createdAt: string): GraphEdge {
    return aresta(leadRef, ref, 'HAS_ACTIVITY', fk('lead_activities.leadId → leads.id', 'Atividade registrada neste lead.'), [
      prop('Registrada em', createdAt),
    ]);
  },
  notaDoLead(leadRef: string, ref: string, createdAt: string): GraphEdge {
    return aresta(leadRef, ref, 'HAS_NOTE', fk('lead_notes.leadId → leads.id', 'Nota escrita neste lead.'), [
      prop('Criada em', createdAt),
    ]);
  },
  contatoDoLead(leadRef: string, ref: string, occurredAt: string): GraphEdge {
    return aresta(leadRef, ref, 'HAS_CONTACT', fk('lead_contact_records.leadId → leads.id', 'Contato registrado com este lead.'), [
      prop('Ocorrido em', occurredAt),
    ]);
  },
  followUpDoLead(leadRef: string, ref: string, dueAt: string): GraphEdge {
    return aresta(leadRef, ref, 'HAS_FOLLOW_UP', fk('lead_follow_ups.leadId → leads.id', 'Follow-up agendado para este lead.'), [
      prop('Previsto para', dueAt),
    ]);
  },
};

// Montagem e fusao -------------------------------------------------------------

/**
 * Aplica o teto de nos. Mantem a ordem recebida (a raiz vem primeiro) e remove
 * arestas orfas. Devolve quantos nos foram cortados.
 */
export function aplicarTeto(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxNodes: number,
): { nodes: GraphNode[]; edges: GraphEdge[]; cortados: Partial<Record<GraphNodeKind, number>> } {
  if (nodes.length <= maxNodes) return { nodes, edges, cortados: {} };

  const mantidos = nodes.slice(0, maxNodes);
  const refs = new Set(mantidos.map((n) => n.ref));
  const cortados: Partial<Record<GraphNodeKind, number>> = {};
  for (const n of nodes.slice(maxNodes)) cortados[n.kind] = (cortados[n.kind] ?? 0) + 1;

  return {
    nodes: mantidos,
    edges: edges.filter((e) => refs.has(e.source) && refs.has(e.target)),
    cortados,
  };
}

/**
 * Funde uma expansao num grafo ja carregado. Idempotente: expandir duas vezes o
 * mesmo no nao duplica nos nem arestas, e a contagem `loaded` de cada opcao e
 * recalculada a partir do que de fato esta no grafo.
 */
export function fundirGrafo(
  atual: { nodes: GraphNode[]; edges: GraphEdge[] },
  novo: { nodes: GraphNode[]; edges: GraphEdge[] },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const porRef = new Map(atual.nodes.map((n) => [n.ref, n] as const));
  for (const n of novo.nodes) if (!porRef.has(n.ref)) porRef.set(n.ref, n);

  const porId = new Map(atual.edges.map((e) => [e.id, e] as const));
  for (const e of novo.edges) if (!porId.has(e.id)) porId.set(e.id, e);

  const nodes = [...porRef.values()];
  const edges = [...porId.values()].filter((e) => porRef.has(e.source) && porRef.has(e.target));

  // `loaded`: vizinhos do tipo que estao ligados ao no, em qualquer sentido.
  // As arestas nem sempre vao do pai ao filho (lead -> pesquisa tem o lead como
  // origem), entao contar so as de saida erraria a expansao da pesquisa.
  const kindPorRef = new Map(nodes.map((n) => [n.ref, n.kind] as const));
  const contagem = new Map<string, number>();
  const somar = (ref: string, outro: string): void => {
    const kind = kindPorRef.get(outro);
    if (!kind) return;
    const chave = `${ref}|${kind}`;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  };
  for (const e of edges) {
    somar(e.source, e.target);
    somar(e.target, e.source);
  }

  return {
    nodes: nodes.map((n) => ({
      ...n,
      expansions: n.expansions.map((x) => ({
        ...x,
        loaded: Math.max(x.loaded, contagem.get(`${n.ref}|${x.kind}`) ?? 0),
      })),
    })),
    edges,
  };
}

/** Vizinhos diretos (um salto, nos dois sentidos) de um no. */
export function vizinhosDiretos(
  edges: readonly GraphEdge[],
  ref: string,
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([ref]);
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.source === ref || e.target === ref) {
      nodes.add(e.source);
      nodes.add(e.target);
      ids.add(e.id);
    }
  }
  return { nodes, edges: ids };
}
