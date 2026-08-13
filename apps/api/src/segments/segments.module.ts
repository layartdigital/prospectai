import { Module } from '@nestjs/common';

import { OutreachModule } from '../outreach/outreach.module';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

@Module({
  // Reaproveita o provider de IA do módulo de abordagem: uma configuração de
  // modelo no sistema inteiro, não duas que divergem.
  imports: [OutreachModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
