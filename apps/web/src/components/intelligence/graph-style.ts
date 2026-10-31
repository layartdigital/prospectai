import type { GraphNode, GraphNodeKind } from '@propectai/types';

/**
 * Aparencia dos nos. Cor identifica o **tipo**; o estado de sinal tem paleta
 * propria (verde / vermelho suave / cinza) porque `DESCONHECIDO` precisa ser
 * cinza neutro, e nunca confundir com `AUSENTE` (CLAUDE.md, regra 4).
 *
 * Nenhuma cor e a unica portadora de informacao: cada no tem sigla e rotulo.
 */
export const KIND_STYLE: Record<GraphNodeKind, { fill: string; ring: string; sigla: string; raio: number }> = {
  LEAD: { fill: '#2F6BFF', ring: '#1F56D9', sigla: 'LD', raio: 26 },
  SEARCH: { fill: '#7C5CFC', ring: '#5B3FD6', sigla: 'PQ', raio: 20 },
  SCORE: { fill: '#F59E0B', ring: '#C77F00', sigla: 'SC', raio: 20 },
  SCORE_REASON: { fill: '#FBBF24', ring: '#C99100', sigla: 'MT', raio: 15 },
  PRESENCE: { fill: '#0EA5A4', ring: '#0B7F7E', sigla: 'PD', raio: 20 },
  SIGNAL: { fill: '#94A3B8', ring: '#64748B', sigla: 'SN', raio: 15 },
  AUDIT: { fill: '#14B8A6', ring: '#0F8F82', sigla: 'AU', raio: 18 },
  AUDIT_CHECK: { fill: '#5EEAD4', ring: '#2BB5A0', sigla: 'VF', raio: 14 },
  PIPELINE_CARD: { fill: '#EC4899', ring: '#BE2F7C', sigla: 'PL', raio: 18 },
  PIPELINE_STAGE: { fill: '#F472B6', ring: '#C94B8E', sigla: 'ET', raio: 15 },
  ACTIVITY: { fill: '#64748B', ring: '#475569', sigla: 'AT', raio: 13 },
  NOTE: { fill: '#8B5CF6', ring: '#6D3FD0', sigla: 'NT', raio: 13 },
  CONTACT_RECORD: { fill: '#22C55E', ring: '#16963F', sigla: 'CT', raio: 14 },
  FOLLOW_UP: { fill: '#F97316', ring: '#C85A0A', sigla: 'FU', raio: 14 },
};

const SIGNAL_FILL = {
  PRESENTE: { fill: '#22C55E', ring: '#16963F' },
  AUSENTE: { fill: '#EF4444', ring: '#B91C1C' },
  DESCONHECIDO: { fill: '#CBD5E1', ring: '#94A3B8' },
} as const;

export function estiloDoNo(n: GraphNode): { fill: string; ring: string; sigla: string; raio: number } {
  const base = KIND_STYLE[n.kind];
  if (n.kind === 'SIGNAL' && n.state) return { ...base, ...SIGNAL_FILL[n.state] };
  return base;
}

export function rotuloCurto(texto: string, max = 24): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

const formatador = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * A API devolve datas em ISO 8601 (contrato estavel, sem fuso de exibicao). A
 * tela as mostra no formato e no fuso do navegador de quem le.
 */
export function humanizarDatas(texto: string): string {
  return texto.replace(ISO, (m) => {
    const d = new Date(m);
    return Number.isNaN(d.getTime()) ? m : formatador.format(d);
  });
}
