import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../common/platform-admin.guard';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // Os limites de plano saíram da constante compilada e vivem no banco, atrás
  // do EntitlementsService — §11.1 passo 2. O painel precisa da mesma fonte
  // que os gates, senão mostra um número e o produto aplica outro.
  imports: [EntitlementsModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
