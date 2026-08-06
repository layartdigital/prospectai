import { MockAIProvider } from '../src/outreach/providers/mock-ai.provider';

/**
 * Este arquivo existe por causa de um bug real.
 *
 * A leitura dos campos do prompt usava `\s*`, que inclui quebra de linha.
 * Quando um campo opcional vinha vazio, a captura pulava para a linha
 * seguinte e trazia o rótulo do próximo campo para dentro da mensagem —
 * o usuário via "CTA:" e "CANAL: WHATSAPP" no texto final.
 *
 * Um teste com todos os campos opcionais vazios teria pego isso antes de
 * chegar à tela.
 */

function buildPrompt(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    EMPRESA: 'Espaço Zen Estética',
    SEGMENTO: 'Clínica de estética',
    CIDADE: 'São Paulo, SP',
    GANCHO: 'Vi que a página de vocês está em um construtor gratuito.',
    SERVICO: 'Sites',
    OBJETIVO: '',
    CTA: '',
    OBSERVACOES: '',
    CANAL: 'WHATSAPP',
    TOM: 'CONSULTIVO',
    ...overrides,
  };

  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

describe('MockAIProvider', () => {
  const provider = new MockAIProvider();

  it('não vaza rótulos do prompt quando campos opcionais estão vazios', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt(),
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    // Nenhum rótulo pode aparecer no texto entregue ao usuário.
    for (const label of ['CTA:', 'CANAL:', 'TOM:', 'OBJETIVO:', 'OBSERVACOES:', 'EMPRESA:']) {
      expect(content).not.toContain(label);
    }
  });

  it('usa a chamada padrão do tom quando o CTA não é informado', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt(),
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    expect(content).toContain('sem compromisso');
  });

  it('usa o CTA informado quando existe', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt({ CTA: 'Posso te mandar dois exemplos?' }),
      channel: 'WHATSAPP',
      tone: 'DIRETO',
    });

    expect(content).toContain('Posso te mandar dois exemplos?');
  });

  it('inclui o gancho vindo do score', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt(),
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    expect(content).toContain('construtor gratuito');
  });

  it('não usa artigo antes do nome da empresa', async () => {
    // "da Espaço Zen Estética" erra o gênero, e o produto não tem como
    // saber o gênero de um nome próprio arbitrário.
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt(),
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    expect(content).toContain('de Espaço Zen Estética');
    expect(content).not.toContain('da Espaço Zen Estética');
  });

  it('acrescenta assunto quando o canal é e-mail', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt({ CANAL: 'EMAIL' }),
      channel: 'EMAIL',
      tone: 'EXECUTIVO',
    });

    expect(content.startsWith('Assunto:')).toBe(true);
  });

  it('marca roteiro quando o canal é ligação', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt({ CANAL: 'PHONE' }),
      channel: 'PHONE',
      tone: 'DIRETO',
    });

    expect(content).toContain('[Roteiro para ligação]');
  });

  it('é determinístico: mesma entrada produz a mesma saída', async () => {
    const prompt = buildPrompt();
    const first = await provider.generateOutreach({
      prompt,
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });
    const second = await provider.generateOutreach({
      prompt,
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    expect(first.content).toBe(second.content);
  });

  it('não inventa dado ausente do prompt', async () => {
    const { content } = await provider.generateOutreach({
      prompt: buildPrompt({ GANCHO: '', SEGMENTO: '' }),
      channel: 'WHATSAPP',
      tone: 'CONSULTIVO',
    });

    // Sem gancho no contexto, a mensagem fica mais curta — não preenchida
    // com afirmação inventada sobre o negócio.
    expect(content).not.toMatch(/unidades|anos de mercado|faturamento/i);
  });
});
