import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AIProvider, OutreachChannel, OutreachTone } from '@propectai/types';

/**
 * Provider de IA sobre a API do Gemini.
 *
 * Implementa o mesmo contrato do `MockAIProvider`, e nenhuma camada acima
 * precisa saber qual está ativo — é a razão de a abstração existir desde a
 * v0.1.1.
 *
 * A restrição do mock continua valendo, e aqui precisa ser dita ao modelo em
 * vez de garantida pelo código: **não afirmar nada que não esteja no
 * contexto**. Um provider que alucina "vi que vocês atendem em três unidades"
 * produz abordagem constrangedora e queima o lead — e o dano é do cliente da
 * agência, não nosso, o que torna o cuidado maior, não menor.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Limite por canal, para o modelo não devolver texto que não cabe.
 *
 * O `Record<OutreachChannel, string>` é intencional em vez de um objeto solto:
 * canal novo no tipo quebra a compilação aqui, em vez de cair num limite
 * genérico silencioso. Foi o que aconteceu ao contrário — escrevi um canal
 * `OTHER` que não existe, e o tipo recusou.
 */
const LIMITE_POR_CANAL: Record<OutreachChannel, string> = {
  WHATSAPP: 'no máximo 4 linhas curtas, tom de mensagem de aplicativo',
  INSTAGRAM: 'no máximo 3 linhas, direto, sem formalidade',
  EMAIL: 'no máximo 2 parágrafos curtos, com assunto implícito na primeira linha',
  PHONE: 'roteiro falado de no máximo 5 linhas, com pausa para resposta',
};

@Injectable()
export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini';
  readonly model: string;

  private readonly logger = new Logger(GeminiAIProvider.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY') ?? '';
    this.model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
  }

  get configurado(): boolean {
    return this.apiKey.length > 0;
  }

  async generateOutreach(input: {
    prompt: string;
    channel: OutreachChannel;
    tone: OutreachTone;
  }): Promise<{ content: string; tokensEstimated: number }> {
    const instrucao = [
      'Você escreve mensagens de primeira abordagem comercial em português do Brasil.',
      '',
      'REGRAS INEGOCIÁVEIS:',
      '- Use apenas os dados fornecidos no contexto. Não invente nada.',
      '- Proibido citar números, resultados, prazos, preços, garantias ou nomes',
      '  de clientes que não estejam no contexto.',
      '- Proibido afirmar que visitou o site, viu o Instagram ou conversou antes.',
      '- Se faltar informação, escreva sem ela. Não preencha com suposição.',
      '- Sem emoji. Sem saudação genérica de vendedor.',
      '',
      `FORMATO: ${LIMITE_POR_CANAL[input.channel]}.`,
      'Devolva apenas a mensagem, sem aspas e sem comentários.',
      '',
      'CONTEXTO:',
      input.prompt,
    ].join('\n');

    const texto = await this.gerar(instrucao, 0.7);

    return {
      content: texto,
      // Estimativa grosseira, suficiente para acompanhar custo por tenant.
      // O número exato viria do `usageMetadata` da resposta.
      tokensEstimated: Math.ceil((instrucao.length + texto.length) / 4),
    };
  }

  /**
   * Termos de busca de um segmento num idioma e país.
   *
   * O que se pede não é tradução: é **como um negócio desse tipo se anuncia
   * naquele país**. "agência de marketing digital" traduzido ao pé da letra
   * pode não ser o termo que as empresas usam no Google Maps local, e termo
   * que ninguém usa devolve busca vazia.
   */
  async gerarTermosLocais(input: {
    segmentName: string;
    macroSegment: string;
    specialty: string | null;
    services: string[];
    sourceTerms: string[];
    locale: string;
    country: string;
  }): Promise<{ label: string; searchTerms: string[] }> {
    const instrucao = [
      'Você conhece como negócios se identificam no Google Maps em cada país.',
      '',
      `PAÍS: ${input.country}   IDIOMA: ${input.locale}`,
      '',
      'TAREFA: dado um tipo de negócio descrito em português do Brasil, devolva',
      'como esse mesmo tipo de negócio aparece no Google Maps do país indicado.',
      '',
      'REGRAS:',
      '- Não traduza ao pé da letra. Use o termo que as empresas realmente usam',
      '  para se anunciar naquele país.',
      '- Entre 3 e 6 termos, do mais comum para o menos comum.',
      '- Termos curtos, como alguém digitaria numa busca.',
      '- Se não souber com segurança como o setor se chama naquele país,',
      '  devolva a lista vazia. Lista vazia é resposta aceitável; termo',
      '  inventado não é — ele produz busca sem resultado e faz o usuário',
      '  concluir que o produto não funciona no país dele.',
      '',
      'NEGÓCIO:',
      `  Segmento: ${input.segmentName}`,
      `  Categoria: ${input.macroSegment}`,
      input.specialty ? `  Especialidade: ${input.specialty}` : '',
      input.services.length ? `  Serviços: ${input.services.slice(0, 6).join(', ')}` : '',
      input.sourceTerms.length
        ? `  Termos em pt-BR: ${input.sourceTerms.slice(0, 6).join(', ')}`
        : '',
      '',
      'Responda em JSON puro, sem cerca de código:',
      '{"label": "nome do segmento no idioma alvo", "searchTerms": ["termo1", "termo2"]}',
    ]
      .filter(Boolean)
      .join('\n');

    // Temperatura baixa: aqui não se quer criatividade, se quer o termo certo.
    const bruto = await this.gerar(instrucao, 0.2);

    return this.interpretarTermos(bruto, input.segmentName);
  }

  // ---------------------------------------------------------------------------

  private async gerar(prompt: string, temperature: number): Promise<string> {
    if (!this.configurado) {
      throw new ServiceUnavailableException(
        'Gemini não configurado. Defina GEMINI_API_KEY.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        `${ENDPOINT}/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: 800 },
          }),
        },
      );

      if (!response.ok) {
        const corpo = await response.text().catch(() => '');
        this.logger.error(`Gemini respondeu ${response.status}: ${corpo.slice(0, 300)}`);
        throw new ServiceUnavailableException(
          'O serviço de IA não respondeu. Tente novamente em instantes.',
        );
      }

      const dados = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };

      const texto = dados.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      // Resposta vazia acontece quando o filtro de segurança bloqueia. Devolver
      // string vazia produziria mensagem em branco salva como se fosse boa.
      if (!texto) {
        throw new ServiceUnavailableException(
          'O serviço de IA devolveu resposta vazia. Ajuste o contexto e tente de novo.',
        );
      }

      return texto;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao chamar o Gemini: ${motivo}`);
      throw new ServiceUnavailableException('Não foi possível falar com o serviço de IA.');
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extrai o JSON da resposta.
   *
   * Modelos costumam embrulhar em cerca de código apesar da instrução. Falhar
   * a interpretação devolve lista vazia em vez de erro: sem termos, a busca
   * continua funcionando com o que a pessoa digitar.
   */
  private interpretarTermos(
    bruto: string,
    fallbackLabel: string,
  ): { label: string; searchTerms: string[] } {
    const limpo = bruto
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    try {
      const dados = JSON.parse(limpo) as { label?: string; searchTerms?: unknown };

      const termos = Array.isArray(dados.searchTerms)
        ? dados.searchTerms
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 6)
        : [];

      return {
        label: typeof dados.label === 'string' && dados.label.trim()
          ? dados.label.trim()
          : fallbackLabel,
        searchTerms: Array.from(new Set(termos)),
      };
    } catch {
      this.logger.warn(`Resposta do Gemini não era JSON: ${limpo.slice(0, 200)}`);
      return { label: fallbackLabel, searchTerms: [] };
    }
  }
}
