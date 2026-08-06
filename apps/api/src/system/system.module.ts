import { Module } from '@nestjs/common';

import { ScraperHealthService } from './scraper-health.service';
import { SystemController } from './system.controller';

@Module({
  controllers: [SystemController],
  providers: [ScraperHealthService],
})
export class SystemModule {}
