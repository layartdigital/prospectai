import { describe, expect, it } from 'vitest';
import {
  INTELLIGENCE_AI_STATUS,
  validarRespostaIa,
  type AiGraphContext,
  type AiResponse,
} from './intelligence-ai-contract';
import { noLead } from './intelligence-graph';

const lead = noLead({ id: 'lead-0000001', name: 'X' } as never, 0, []);
const ctx = { contractVersion: '0.1.0', leadId: 'lead-0000001', nodes: [lead], edges: [] } as AiGraphContext;
const base = (over: Partial<AiResponse>): AiResponse => ({
  contractVersion: '0.1.0',
  task: 'RESUMIR_LEAD',
  claims: [],
  sugestoesDeRelacao: [],
  proveniencia: { provedor: 'x', modelo: 'y', geradoEm: '2026-01-01T00:00:00Z' },
  ...over,
});

describe('contrato de IA', () => {
  it('o estado real e INDISPONIVEL: nao ha provedor aprovado', () => {
    expect(INTELLIGENCE_AI_STATUS).toBe('INDISPONIVEL');
  });
  it('rejeita afirmacao sem evidencia', () => {
    expect(validarRespostaIa(base({ claims: [{ texto: 'a', evidencias: [], confianca: 'ALTA' }] }), ctx).ok).toBe(false);
  });
  it('rejeita evidencia fora do contexto', () => {
    expect(validarRespostaIa(base({ claims: [{ texto: 'a', evidencias: ['LEAD:outro-tenant-1'], confianca: 'BAIXA' }] }), ctx).ok).toBe(false);
  });
  it('aceita afirmacao ancorada em no do contexto', () => {
    expect(validarRespostaIa(base({ claims: [{ texto: 'a', evidencias: [lead.ref], confianca: 'MEDIA' }] }), ctx).ok).toBe(true);
  });
});
