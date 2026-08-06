import type {
  AIProvider,
  OutreachChannel,
  OutreachTone,
} from '@propectai/types';

/**
 * Provider de IA determinístico.
 *
 * Não inventa dado. As frases são montadas a partir do que o prompt carrega —
 * que por sua vez só contém informação já verificada do lead. Um provider que
 * alucinasse "vi que vocês atendem em três unidades" produziria abordagem
 * constrangedora e queimaria o lead.
 *
 * Quando um provider externo entrar, esta mesma restrição precisa valer:
 * o prompt instrui explicitamente a não afirmar nada fora do contexto.
 */

interface Ingredients {
  business: string;
  hook: string;
  service: string;
  objective: string;
  cta: string;
  notes: string;
}

/**
 * Sem artigo antes do nome da empresa.
 *
 * "da Espaço Zen Estética" erra o gênero; "de Espaço Zen Estética" funciona
 * para qualquer nome, e o produto não tem como saber o gênero de um nome
 * próprio arbitrário.
 */
const GREETINGS: Record<OutreachTone, (name: string) => string> = {
  CONSULTIVO: (name) => `Olá! Tudo bem? Estava analisando a presença digital de ${name}`,
  DIRETO: (name) => `Olá! Falo com o responsável por ${name}?`,
  INFORMAL: (name) => `Oi! Tudo certo? Passei pelo perfil de ${name}`,
  EXECUTIVO: (name) => `Prezados, escrevo sobre a presença digital de ${name}`,
};

const CLOSINGS: Record<OutreachTone, string> = {
  CONSULTIVO: 'Se fizer sentido, posso te mostrar sem compromisso.',
  DIRETO: 'Consigo te mostrar em 10 minutos.',
  INFORMAL: 'Se quiser, mando uns exemplos por aqui.',
  EXECUTIVO: 'Fico à disposição para agendar uma conversa.',
};

export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly model = null;

  async generateOutreach(input: {
    prompt: string;
    channel: OutreachChannel;
    tone: OutreachTone;
  }): Promise<{ content: string; tokensEstimated: number }> {
    const parsed = this.parsePrompt(input.prompt);
    const content = this.compose(parsed, input.channel, input.tone);

    return {
      content,
      // Estimativa grosseira, registrada para efeito de auditoria de uso.
      tokensEstimated: Math.ceil((input.prompt.length + content.length) / 4),
    };
  }

  private parsePrompt(prompt: string): Ingredients {
    const read = (key: string): string => {
      // [^\S\r\n] é "espaço em branco que não seja quebra de linha".
      //
      // Usar \s aqui era um bug: \s inclui \n, então um campo vazio fazia a
      // captura saltar para a linha seguinte e trazer o rótulo do próximo
      // campo para dentro da mensagem ("CTA:", "CANAL: WHATSAPP").
      const match = new RegExp(`^${key}:[^\\S\\r\\n]*(.+)$`, 'm').exec(prompt);
      const value = match?.[1]?.trim() ?? '';

      // Rede de segurança: se algo ainda casar com um rótulo, descarta.
      return /^[A-Z_]+:/.test(value) ? '' : value;
    };

    return {
      business: read('EMPRESA') || 'sua empresa',
      hook: read('GANCHO'),
      service: read('SERVICO') || 'presença digital',
      objective: read('OBJETIVO'),
      cta: read('CTA'),
      notes: read('OBSERVACOES'),
    };
  }

  private compose(
    parts: Ingredients,
    channel: OutreachChannel,
    tone: OutreachTone,
  ): string {
    const greeting = GREETINGS[tone](parts.business);
    const lines: string[] = [];

    if (channel === 'EMAIL') {
      lines.push(`Assunto: ${parts.service} para a ${parts.business}`, '');
    }

    lines.push(`${greeting}.`);

    if (parts.hook) lines.push('', parts.hook);

    lines.push(
      '',
      `Trabalho com ${parts.service.toLowerCase()} e ajudo negócios locais a aparecerem melhor para quem já está procurando por eles.`,
    );

    if (parts.objective) lines.push('', parts.objective);
    if (parts.notes) lines.push('', parts.notes);

    lines.push('', parts.cta || CLOSINGS[tone]);

    if (channel === 'PHONE') {
      lines.unshift('[Roteiro para ligação]', '');
    }

    return lines.join('\n').trim();
  }
}
