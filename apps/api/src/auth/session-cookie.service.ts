import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_COOKIES } from '@propectai/types';
import type { CookieOptions, Response } from 'express';

import type { RequestWithContext } from '../common/request-context';
import { AuthService } from './auth.service';

/**
 * Emissão e escrita dos cookies de sessão.
 *
 * Vive fora do AuthController porque o aceite de convite também abre sessão.
 * Política de cookie duplicada em dois lugares é política que diverge — e o
 * dia em que um deles esquecer o `httpOnly` ninguém percebe, porque continua
 * funcionando.
 */
@Injectable()
export class SessionCookieService {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  async start(
    userId: string,
    request: RequestWithContext,
    response: Response,
  ): Promise<void> {
    const issued = await this.auth.issueTokens(userId, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    this.write(response, issued.accessToken, issued.refreshToken, issued.refreshExpiresAt);
  }

  write(
    response: Response,
    accessToken: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): void {
    response.cookie(AUTH_COOKIES.access, accessToken, {
      ...this.options(),
      maxAge: 15 * 60 * 1000,
    });

    response.cookie(AUTH_COOKIES.refresh, refreshToken, {
      ...this.options(),
      expires: refreshExpiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(AUTH_COOKIES.access, this.options());
    response.clearCookie(AUTH_COOKIES.refresh, this.options());
  }

  options(): CookieOptions {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      // SameSite=Lax cobre o CSRF de navegação. Em produção, com front e API
      // em domínios distintos, isto vira 'none' + secure e exige token CSRF.
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    };
  }
}
