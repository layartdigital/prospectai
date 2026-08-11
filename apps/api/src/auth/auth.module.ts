import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { TenantGuard } from '../common/tenant.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionCookieService } from './session-cookie.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SessionCookieService, JwtAuthGuard, TenantGuard],
  exports: [AuthService, SessionCookieService, JwtAuthGuard, TenantGuard, JwtModule],
})
export class AuthModule {}
