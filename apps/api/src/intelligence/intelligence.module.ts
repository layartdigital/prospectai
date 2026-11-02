import { Module } from '@nestjs/common';

import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';

/**
 * Intelligence Explorer (Prompt 04, incremento P04-I1).
 *
 * Nao declara PrismaService nem EntitlementsService: ambos vem de modulos
 * globais. Nao abre caminho privilegiado — a leitura usa `comTenant`, do papel
 * de runtime sujeito a RLS.
 */
@Module({
  controllers: [IntelligenceController],
  providers: [IntelligenceService],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}
