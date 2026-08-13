import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AdminTenantList } from '@propectai/types';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PlatformAdminGuard } from '../common/platform-admin.guard';
import type { AuthenticatedUser } from '../common/request-context';
import { AdminService } from './admin.service';

export class ChangePlanDto {
  @IsIn(['FREE', 'START', 'PRO', 'AGENCY'])
  planCode!: 'FREE' | 'START' | 'PRO' | 'AGENCY';

  @IsString()
  @MinLength(3, { message: 'Descreva o motivo da troca' })
  @MaxLength(400)
  reason!: string;
}

export class SuspendTenantDto {
  @IsString()
  @MinLength(3, { message: 'Descreva o motivo da suspensão' })
  @MaxLength(400)
  reason!: string;
}

/**
 * Painel do provedor.
 *
 * **Sem `TenantGuard`.** É o único controller do sistema que enxerga todos os
 * tenants, e a ausência é intencional: passar por ele exigiria um tenant
 * ativo, que aqui não existe. A separação é a garantia — guarda própria,
 * tabela própria, prefixo próprio.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('tenants')
  @ApiOperation({
    summary: 'Todos os tenants da plataforma',
    description:
      'Plano, consumo do período, número de membros, última atividade e ' +
      'estado de suspensão. Substitui a consulta manual ao banco, que era o ' +
      'único caminho até aqui.',
  })
  @ApiResponse({ status: 403, description: 'Não é operador da plataforma' })
  async tenants(): Promise<AdminTenantList> {
    return this.admin.listTenants();
  }

  @Patch('tenants/:id/plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Trocar o plano de um tenant',
    description:
      'Substitui `pnpm db:plan`, que por desenho só age em tenant de ' +
      'demonstração. O motivo é obrigatório e vai para o AuditLog: troca sem ' +
      'justificativa vira mistério em auditoria seis meses depois.',
  })
  async changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
  ): Promise<void> {
    await this.admin.changePlan(id, user.id, dto);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Suspender acesso do tenant',
    description:
      'Bloqueia o acesso sem apagar dado. O bloqueio efetivo acontece no ' +
      'TenantGuard, e as sessões abertas são revogadas na hora — sem isso, ' +
      'quem já estava dentro seguiria trabalhando até o token expirar.',
  })
  async suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspendTenantDto,
  ): Promise<void> {
    await this.admin.suspend(id, user.id, dto.reason);
  }

  @Post('tenants/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reativar tenant suspenso' })
  async reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.admin.reactivate(id, user.id);
  }
}
