import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AuditsModule } from './audits/audits.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { LeadsModule } from './leads/leads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutreachModule } from './outreach/outreach.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrivacyModule } from './privacy/privacy.module';
import { ProposalsModule } from './proposals/proposals.module';
import { ProspectingModule } from './prospecting/prospecting.module';
import { RedisModule } from './redis/redis.module';
import { SegmentsModule } from './segments/segments.module';
import { SystemModule } from './system/system.module';
import { TeamModule } from './team/team.module';

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
    AuditsModule,
    AdminModule,
    BillingModule,
    EntitlementsModule,
    DashboardModule,
    LeadsModule,
    NotificationsModule,
    OutreachModule,
    PipelineModule,
    PrivacyModule,
    ProposalsModule,
    ProspectingModule,
    SegmentsModule,
    SystemModule,
    TeamModule,
  ],
})
export class AppModule {}
