import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  OUTREACH_CHANNELS,
  OUTREACH_TONES,
  type OutreachChannel,
  type OutreachMessageView,
  type OutreachQuotaView,
  type OutreachTone,
} from '@propectai/types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentTenant, CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { OutreachService } from './outreach.service';

export class GenerateOutreachDto {
  @IsIn([...OUTREACH_CHANNELS])
  channel!: OutreachChannel;

  @IsIn([...OUTREACH_TONES])
  tone!: OutreachTone;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceOffered?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  callToAction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  extraNotes?: string;
}

export class UpdateOutreachDto {
  @IsString()
  @MaxLength(4000)
  content!: string;
}

@ApiTags('ai')
@Controller('ai/outreach')
@UseGuards(JwtAuthGuard, TenantGuard)
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get('quota')
  @ApiOperation({
    summary: 'Saldo de gerações por IA',
    description:
      'Gerações usadas e disponíveis no período. Consultar não dispara ' +
      'bloqueio — o card fica visível e contextualizado mesmo no plano FREE.',
  })
  async quota(@CurrentTenant() tenant: ActiveTenant): Promise<OutreachQuotaView> {
    return this.outreach.quota(tenant.id, tenant.planCode);
  }

  @Get('lead/:leadId')
  @ApiOperation({
    summary: 'Histórico de abordagens do lead',
    description: 'Versões geradas, da mais recente para a mais antiga.',
  })
  async list(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('leadId') leadId: string,
  ): Promise<OutreachMessageView[]> {
    return this.outreach.list(tenant.id, leadId);
  }

  @Post('lead/:leadId/generate')
  @ApiOperation({
    summary: 'Gerar abordagem',
    description:
      'Monta o prompt a partir dos dados verificados do lead e do score, e ' +
      'gera o rascunho com o AIProvider ativo (mock na v0.1.1). Consome uma ' +
      'geração da cota do plano. Bloqueia com PLAN_LIMIT quando o plano não ' +
      'inclui IA — sempre após tentativa explícita, nunca ao carregar a tela. ' +
      'Nenhuma mensagem é enviada automaticamente.',
  })
  @ApiResponse({ status: 201, description: 'Rascunho gerado' })
  @ApiResponse({ status: 403, description: 'Plano sem IA ou cota esgotada' })
  async generate(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
    @Body() dto: GenerateOutreachDto,
  ): Promise<OutreachMessageView> {
    return this.outreach.generate(tenant.id, leadId, user.id, tenant.planCode, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar rascunho',
    description: 'O texto gerado é ponto de partida, não palavra final.',
  })
  async update(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('id') id: string,
    @Body() dto: UpdateOutreachDto,
  ): Promise<OutreachMessageView> {
    return this.outreach.update(tenant.id, id, dto.content);
  }

  @Post(':id/mark-sent')
  @ApiOperation({
    summary: 'Registrar como enviada',
    description:
      'Cria LeadContactRecord vinculado à abordagem e atualiza a data do ' +
      'último contato. O envio em si é feito pelo usuário fora do produto.',
  })
  async markSent(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OutreachMessageView> {
    return this.outreach.markAsSent(tenant.id, id, user.id);
  }
}
