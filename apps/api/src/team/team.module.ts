import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../entitlements/entitlements.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [EntitlementsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
