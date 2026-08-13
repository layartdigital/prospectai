import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AIProvider } from '@propectai/types';

import { GeminiAIProvider } from './gemini-ai.provider';
import { MockAIProvider } from './mock-ai.provider';

/**
 * Escolhe o provider de IA ativo.
 *
 * `AI_PROVIDER=gemini` com `GEMINI_API_KEY` presente usa o Gemini; qualquer
 * outra combinação cai no mock determinístico.
 *
 * **A queda para o mock é registrada em log, e de propósito não é silenciosa.**
 * Um ambiente que deveria usar Gemini e usa mock produz mensagens plausíveis
 * porém genéricas — que passam despercebidas até alguém comparar a saída com o
 * que esperava. Erro de configuração que degrada em silêncio é o pior tipo.
 */
@Injectable()
export class AIProviderFactory {
  private readonly logger = new Logger(AIProviderFactory.name);
  private readonly ativo: AIProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly gemini: GeminiAIProvider,
  ) {
    const escolhido = (this.config.get<string>('AI_PROVIDER') ?? 'mock').toLowerCase();

    if (escolhido === 'gemini') {
      if (this.gemini.configurado) {
        this.logger.log(`Provider de IA: gemini (${this.gemini.model})`);
        this.ativo = this.gemini;
        return;
      }

      this.logger.warn(
        'AI_PROVIDER=gemini, mas GEMINI_API_KEY está ausente. Usando o mock — ' +
          'as abordagens serão determinísticas, não geradas.',
      );
    } else {
      this.logger.log('Provider de IA: mock determinístico');
    }

    this.ativo = new MockAIProvider();
  }

  get(): AIProvider {
    return this.ativo;
  }
}
