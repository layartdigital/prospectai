import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../common/platform-admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
