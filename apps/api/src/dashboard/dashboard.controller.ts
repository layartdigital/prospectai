import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { DashboardResponse } from '@propectai/types';

import { CurrentTenant } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Indicadores da visão geral',
    description:
      'Devolve KPIs, buscas recentes e distribuição do funil do tenant ativo. ' +
      'Exige sessão; o tenant vem da sessão ou do header x-tenant-id, sempre ' +
      'validado contra o Membership. Nenhum plano é exigido — visualizar ' +
      'indicadores não é recurso pago.',
  })
  @ApiResponse({ status: 200, description: 'Indicadores calculados por query' })
  @ApiResponse({ status: 401, description: 'Sem sessão' })
  @ApiResponse({ status: 403, description: 'Sem acesso a este workspace' })
  async overview(@CurrentTenant() tenant: ActiveTenant): Promise<DashboardResponse> {
    return this.dashboard.overview(tenant.id);
  }
}
