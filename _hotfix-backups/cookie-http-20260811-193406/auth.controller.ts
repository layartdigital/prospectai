import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIES, type SessionResponse } from '@propectai/types';
import type { CookieOptions, Response } from 'express';

import { CurrentUser, Public } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { AuthenticatedUser, RequestWithContext } from '../common/request-context';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Criar conta e workspace',
    description:
      'Cria usuário, tenant, membership OWNER, assinatura FREE, estado de ' +
      'onboarding e as oito etapas padrão do pipeline. Senha com Argon2. ' +
      'Grava AuditLog. Não exige autenticação.',
  })
  @ApiResponse({ status: 201, description: 'Conta criada e sessão iniciada' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const { userId } = await this.auth.register(dto);
    await this.startSession(userId, request, response);
    return this.auth.getSession(userId);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autenticar',
    description:
      'Valida credenciais e emite access token (curto) e refresh token ' +
      '(opaco, revogável) em cookies HttpOnly. E-mail inexistente e senha ' +
      'incorreta devolvem a mesma mensagem, de propósito.',
  })
  @ApiResponse({ status: 200, description: 'Sessão iniciada' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const userId = await this.auth.validateCredentials(dto.email, dto.password);
    await this.startSession(userId, request, response);
    return this.auth.getSession(userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renovar sessão',
    description:
      'Troca o refresh token por um par novo. O token antigo é revogado e ' +
      'passa a apontar para o substituto, o que permite detectar reuso.',
  })
  @ApiResponse({ status: 200, description: 'Sessão renovada' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido ou expirado' })
  async refresh(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[AUTH_COOKIES.refresh];

    if (!token) throw new UnauthorizedException('Sessão não encontrada');

    const issued = await this.auth.rotateRefreshToken(token, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    this.writeCookies(
      response,
      issued.accessToken,
      issued.refreshToken,
      issued.refreshExpiresAt,
    );

    return this.auth.getSession(issued.userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerrar sessão',
    description: 'Revoga o refresh token no banco e limpa os cookies.',
  })
  async logout(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const cookies = request.cookies as Record<string, string> | undefined;
    await this.auth.revokeRefreshToken(cookies?.[AUTH_COOKIES.refresh]);

    response.clearCookie(AUTH_COOKIES.access, this.cookieOptions());
    response.clearCookie(AUTH_COOKIES.refresh, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Sessão atual',
    description:
      'Devolve usuário, tenant ativo, lista de tenants acessíveis e se o ' +
      'onboarding foi concluído. Consumido pelo App Shell a cada navegação.',
  })
  @ApiResponse({ status: 200, description: 'Dados da sessão' })
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithContext,
  ): Promise<SessionResponse> {
    const header = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(header) ? header[0] : header;
    return this.auth.getSession(user.id, tenantId);
  }

  // ---------------------------------------------------------------------------

  private async startSession(
    userId: string,
    request: RequestWithContext,
    response: Response,
  ): Promise<void> {
    const issued = await this.auth.issueTokens(userId, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    this.writeCookies(
      response,
      issued.accessToken,
      issued.refreshToken,
      issued.refreshExpiresAt,
    );
  }

  private writeCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): void {
    response.cookie(AUTH_COOKIES.access, accessToken, {
      ...this.cookieOptions(),
      maxAge: 15 * 60 * 1000,
    });

    response.cookie(AUTH_COOKIES.refresh, refreshToken, {
      ...this.cookieOptions(),
      expires: refreshExpiresAt,
    });
  }

  private cookieOptions(): CookieOptions {
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
