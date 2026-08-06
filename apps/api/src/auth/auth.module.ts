import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { TenantGuard } from '../common/tenant.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, TenantGuard],
  exports: [AuthService, JwtAuthGuard, TenantGuard, JwtModule],
})
export class AuthModule {}
