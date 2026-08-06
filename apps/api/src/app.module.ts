import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { LeadsModule } from './leads/leads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutreachModule } from './outreach/outreach.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProposalsModule } from './proposals/proposals.module';
import { ProspectingModule } from './prospecting/prospecting.module';
import { RedisModule } from './redis/redis.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // O .env vive na raiz do monorepo, nao dentro de apps/api.
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    AccountModule,
    EntitlementsModule,
    DashboardModule,
    LeadsModule,
    NotificationsModule,
    OutreachModule,
    PipelineModule,
    ProposalsModule,
    ProspectingModule,
    SystemModule,
  ],
})
export class AppModule {}
