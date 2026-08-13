import { Module } from '@nestjs/common';

import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';
import { AIProviderFactory } from './providers/ai-provider.factory';
import { GeminiAIProvider } from './providers/gemini-ai.provider';

@Module({
  controllers: [OutreachController],
  providers: [OutreachService, AIProviderFactory, GeminiAIProvider],
  // Exportado para a taxonomia gerar termos por locale com o mesmo provider —
  // uma configuração de IA no sistema, não duas.
  exports: [GeminiAIProvider, AIProviderFactory],
})
export class OutreachModule {}
