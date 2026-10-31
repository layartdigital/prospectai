/**
 * Contrato tipado da camada de IA do Intelligence Explorer (P04-I1).
 *
 * ESTE ARQUIVO E SO UM CONTRATO. Nao ha provedor de IA aprovado, nenhum endpoint
 * que o use e nenhum botao na interface. Existe para que, quando um provedor for
 * aprovado, a integracao nao mude o formato do grafo nem invente campos.
 *
 * Regras que o contrato impoe a qualquer implementacao futura:
 *  - a IA recebe apenas o subgrafo que o usuario ja pode ver (mesmo tenant, mesmos
 *    limites), nunca consulta o banco por conta propria;
 *  - toda afirmacao da resposta aponta para as entidades (`evidencias`) que a
 *    sustentam; afirmacao sem evidencia nao e aceita;
 *  - sinal `DESCONHECIDO` continua `DESCONHECIDO`: a IA nao o converte em `AUSENTE`;
 *  - relacao sugerida pela IA e `INFERIDA`, nunca `VERIFICADA`;
 *  - dados pessoais de terceiros nao entram no contexto.
 */
import type { GraphEdge, GraphNode } from './intelligence-graph';

export const INTELLIGENCE_AI_CONTRACT_VERSION = '0.1.0';

export type AiAvailability = 'INDISPONIVEL' | 'DISPONIVEL';

/** Estado real hoje. Nenhum provedor aprovado: a interface deve dizer isso, nao simular. */
export const INTELLIGENCE_AI_STATUS: AiAvailability = 'INDISPONIVEL';

export type AiTaskKind = 'RESUMIR_LEAD' | 'EXPLICAR_RELACAO' | 'SUGERIR_PROXIMO_PASSO';

export interface AiGraphContext {
  contractVersion: typeof INTELLIGENCE_AI_CONTRACT_VERSION;
  leadId: string;
  /** Subgrafo ja filtrado por tenant e por plano; nada alem disso. */
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface AiRequest {
  task: AiTaskKind;
  context: AiGraphContext;
  /** Pergunta livre do usuario, quando houver. Tamanho limitado na validacao. */
  pergunta?: string;
}

export interface AiClaim {
  texto: string;
  /** Refs (`KIND:id`) das entidades do contexto que sustentam a afirmacao. Nao vazio. */
  evidencias: readonly string[];
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA';
}

export interface AiResponse {
  contractVersion: typeof INTELLIGENCE_AI_CONTRACT_VERSION;
  task: AiTaskKind;
  claims: readonly AiClaim[];
  /** Relacoes sugeridas: sempre INFERIDA e com a regra/justificativa explicita. */
  sugestoesDeRelacao: readonly {
    source: string;
    target: string;
    justificativa: string;
    verification: 'INFERIDA';
  }[];
  proveniencia: {
    provedor: string;
    modelo: string;
    geradoEm: string;
  };
}

/** Rejeita resposta que viole o contrato (afirmacao sem evidencia ou com ref fora do contexto). */
export function validarRespostaIa(
  resposta: AiResponse,
  contexto: AiGraphContext,
): { ok: true } | { ok: false; motivo: string } {
  const refs = new Set(contexto.nodes.map((n) => n.ref));
  for (const c of resposta.claims) {
    if (c.evidencias.length === 0) return { ok: false, motivo: 'afirmacao sem evidencia' };
    const fora = c.evidencias.find((r) => !refs.has(r));
    if (fora) return { ok: false, motivo: `evidencia fora do contexto: ${fora}` };
  }
  for (const s of resposta.sugestoesDeRelacao) {
    if (!refs.has(s.source) || !refs.has(s.target)) return { ok: false, motivo: 'relacao sugerida fora do contexto' };
    if (s.verification !== 'INFERIDA') return { ok: false, motivo: 'sugestao nao pode ser VERIFICADA' };
  }
  return { ok: true };
}
