import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUTH_COOKIES } from '@propectai/types';

import { IS_PUBLIC_KEY } from './decorators';
import type { JwtPayload, RequestWithContext } from './request-context';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Sessão não encontrada');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
  }

  /**
   * Aceita cookie HttpOnly ou header Authorization.
   *
   * O cookie atende o navegador e os Server Components do Next; o header
   * atende integrações e o Swagger.
   */
  private extractToken(request: RequestWithContext): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[AUTH_COOKIES.access];
    if (fromCookie) return fromCookie;

    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    return null;
  }
}
