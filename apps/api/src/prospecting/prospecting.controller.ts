import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { SearchQuotaResponse, SearchStatusResponse } from '@propectai/types';

import { CurrentTenant, CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { CreateSearchDto } from './prospecting.dto';
import { ProspectingService } from './prospecting.service';

@ApiTags('prospecting')
@Controller('prospecting')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProspectingController {
  constructor(private readonly prospecting: ProspectingService) {}

  @Get('quota')
  @ApiOperation({
    summary: 'Saldo de leads',
    description:
      'Leads incluídos no plano, consumidos e disponíveis no período. ' +
      'Consultar o saldo não dispara bloqueio — o gate só age quando o ' +
      'usuário tenta criar uma busca sem saldo.',
  })
  async quota(@CurrentTenant() tenant: ActiveTenant): Promise<SearchQuotaResponse> {
    return this.prospecting.quota(tenant.id, tenant.planCode);
  }

  @Post('searches')
  @ApiOperation({
    summary: 'Criar busca',
    description:
      'Valida saldo, cria ProspectingSearch e ScrapeJob, reserva a cota e ' +
      'enfileira no BullMQ. A chave de idempotência inclui nicho, local, raio ' +
      'e data: repetir a mesma busca no mesmo dia devolve o job existente em ' +
      'vez de cobrar de novo. Grava AuditLog.',
  })
  @ApiResponse({ status: 201, description: 'Busca criada e enfileirada' })
  @ApiResponse({ status: 403, description: 'Sem saldo de leads no plano' })
  async create(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSearchDto,
  ) {
    return this.prospecting.createSearch(tenant.id, user.id, tenant.planCode, dto);
  }

  @Get('searches/:id/status')
  @ApiOperation({
    summary: 'Acompanhar busca',
    description:
      'Estado do job com percentual e mensagem. O progresso deriva do estado ' +
      '(QUEUED, RUNNING, NORMALIZING, SCORING), não de contagem parcial — ' +
      'nenhum lead fica visível antes do score terminar.',
  })
  @ApiResponse({ status: 200, description: 'Estado atual do job' })
  @ApiResponse({ status: 404, description: 'Busca não encontrada' })
  async status(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('id') id: string,
  ): Promise<SearchStatusResponse> {
    return this.prospecting.status(tenant.id, id);
  }
}
