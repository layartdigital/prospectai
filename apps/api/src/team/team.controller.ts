import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  InvitationPreview,
  InvitationView,
  SessionResponse,
  TeamView,
} from '@propectai/types';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';

import { AuthService } from '../auth/auth.service';
import { SessionCookieService } from '../auth/session-cookie.service';
import { CurrentTenant, CurrentUser, MinRole, Public } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type {
  ActiveTenant,
  AuthenticatedUser,
  RequestWithContext,
} from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { TeamService } from './team.service';

const PAPEIS = ['OWNER', 'ADMIN', 'MANAGER', 'SDR', 'VIEWER'] as const;

export class InviteMemberDto {
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(160)
  email!: string;

  @IsIn(PAPEIS)
  role!: (typeof PAPEIS)[number];
}

export class ChangeRoleDto {
  @IsIn(PAPEIS)
  role!: (typeof PAPEIS)[number];
}

export class AcceptInvitationDto {
  @IsString()
  @MaxLength(400)
  token!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsString()
  @MinLength(10, { message: 'A senha precisa de pelo menos 10 caracteres' })
  @MaxLength(128)
  password!: string;
}

@ApiTags('team')
@Controller()
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly auth: AuthService,
    private readonly sessionCookie: SessionCookieService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dentro do workspace
  // ---------------------------------------------------------------------------

  @Get('team')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary: 'Membros e convites pendentes',
    description:
      'Lista quem tem acesso ao workspace e os convites em aberto. ' +
      '`seatsUsed` conta membros ativos **mais convites pendentes** — sem isso, ' +
      'mil convites furariam o limite do plano sem ninguém ter entrado. ' +
      'Visualizar a equipe não exige papel elevado nem plano pago.',
  })
  async list(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TeamView> {
    return this.team.list(tenant.id, tenant.planCode, user.id);
  }

  @Post('team/invitations')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('ADMIN')
  @ApiOperation({
    summary: 'Convidar pessoa para o workspace',
    description:
      'Cria convite com token de sete dias e devolve o link de aceite. ' +
      '**O link só existe nesta resposta** — o token é guardado como hash, e ' +
      'não há envio de e-mail no produto: quem convida copia e envia pelo ' +
      'canal que preferir. Ninguém concede papel acima do próprio. O limite ' +
      'do plano é verificado aqui, na tentativa.',
  })
  @ApiResponse({ status: 201, description: 'Convite criado, com link de aceite' })
  @ApiResponse({ status: 403, description: 'Papel insuficiente ou limite do plano' })
  @ApiResponse({ status: 409, description: 'Já é membro ou já tem convite pendente' })
  async invite(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ): Promise<InvitationView> {
    return this.team.invite(
      tenant.id,
      tenant.planCode,
      { id: user.id, role: tenant.role },
      dto,
    );
  }

  @Delete('team/invitations/:id')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revogar convite pendente' })
  async revoke(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.team.revokeInvitation(tenant.id, id, user.id);
  }

  @Patch('team/members/:id/role')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('ADMIN')
  @ApiOperation({
    summary: 'Alterar papel de um membro',
    description:
      'Nem conceder acima do próprio papel, nem alterar quem está acima. ' +
      'Rebaixar o último dono é recusado: workspace sem dono não tem quem ' +
      'mude plano, convide ou remova — estado irrecuperável pela interface.',
  })
  @ApiResponse({ status: 400, description: 'É o último dono do workspace' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<void> {
    await this.team.changeRole(tenant.id, id, { id: user.id, role: tenant.role }, dto.role);
  }

  @Delete('team/members/:id')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @MinRole('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remover acesso de um membro',
    description:
      'Soft delete no vínculo e revogação dos refresh tokens da pessoa — sem ' +
      'isso, quem foi removido continua trabalhando até o access token expirar. ' +
      'O usuário não é apagado: contatos e notas apontam para o autor.',
  })
  async remove(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.team.removeMember(tenant.id, id, { id: user.id, role: tenant.role });
  }

  // ---------------------------------------------------------------------------
  // Aceite — sem sessão
  // ---------------------------------------------------------------------------

  @Public()
  @Get('invitations/:token')
  @ApiOperation({
    summary: 'Dados do convite antes do aceite',
    description:
      'Rota pública: quem foi convidado ainda não tem conta. Devolve o nome ' +
      'do workspace, o papel e se já existe conta com aquele e-mail — o que ' +
      'define se o aceite pede nome e senha nova ou só a senha atual.',
  })
  @ApiResponse({ status: 404, description: 'Convite inválido, expirado ou já usado' })
  async preview(@Param('token') token: string): Promise<InvitationPreview> {
    return this.team.previewInvitation(token);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aceitar convite e abrir sessão',
    description:
      'Conta nova é criada com a senha escolhida pelo convidado — quem convida ' +
      'nunca vê a senha de ninguém. Conta existente exige a senha atual, que é ' +
      'o que impede alguém de posse do link anexar um workspace à conta alheia.',
  })
  @ApiResponse({ status: 403, description: 'Senha incorreta para conta existente' })
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const { userId } = await this.team.accept(dto);
    await this.sessionCookie.start(userId, request, response);
    return this.auth.getSession(userId);
  }
}
