import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentTenant, CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { CreateAuditDto } from './audits.dto';
import { AuditsService } from './audits.service';

@ApiTags('audits')
@Controller('audits')
@UseGuards(JwtAuthGuard, TenantGuard)
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Get('quota')
  @ApiOperation({
    summary: 'Saldo de auditorias',
    description:
      'Auditorias incluídas no plano e disponíveis no período. Consultar o ' +
      'saldo nunca dispara bloqueio — o gate só age quando o usuário tenta ' +
      'executar uma auditoria (regra 5).',
  })
  async quota(@CurrentTenant() tenant: ActiveTenant) {
    return this.audits.saldo(tenant.id, tenant.planCode);
  }

  @Post()
  @ApiOperation({
    summary: 'Pedir auditoria de presença digital',
    description:
      'Consome um crédito, cria a auditoria e enfileira. O site auditado sai ' +
      'do `Lead.website` — nunca do corpo da requisição, porque deixar o ' +
      'cliente escolher a URL seria deixá-lo escolher o destino da conexão ' +
      'que o worker abre. Lead sem site é recusado sem consumir crédito.',
  })
  @ApiResponse({ status: 201, description: 'Auditoria criada e enfileirada' })
  @ApiResponse({ status: 400, description: 'Lead sem site cadastrado' })
  @ApiResponse({ status: 403, description: 'Sem auditorias disponíveis no plano' })
  @ApiResponse({ status: 404, description: 'Lead não encontrado neste workspace' })
  async criar(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAuditDto,
  ) {
    return this.audits.criar(tenant.id, user.id, tenant.planCode, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Resultado da auditoria',
    description:
      'Estado e checagens. `COMPLETED` com checagens reprovadas é sucesso — ' +
      'a medição é o produto. `FAILED` significa que nós não conseguimos ' +
      'medir, e nesse caso o crédito volta.',
  })
  @ApiResponse({ status: 200, description: 'Auditoria com suas checagens' })
  @ApiResponse({ status: 404, description: 'Auditoria não encontrada neste workspace' })
  async detalhe(@CurrentTenant() tenant: ActiveTenant, @Param('id') id: string) {
    return this.audits.detalhe(tenant.id, id);
  }
}
