import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { PreferencesView, SubscriptionResponse } from '@propectai/types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CurrentTenant, CurrentUser, MinRole } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { AccountService } from './account.service';

export class SetSegmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  segmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  applyDefaults?: boolean;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  servicesSold?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  targetNiches?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  targetRegions?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  preferredChannel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  monthlyGoal?: string;
}

@ApiTags('account')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('subscription')
  @ApiOperation({
    summary: 'Plano atual, consumo e catálogo',
    description:
      'Devolve o plano vigente, o consumo real do período e os quatro planos ' +
      'para comparação. Visualizar planos nunca é bloqueado — seria absurdo ' +
      'exigir upgrade para ver os upgrades.',
  })
  @ApiResponse({ status: 200, description: 'Assinatura e catálogo' })
  async subscription(
    @CurrentTenant() tenant: ActiveTenant,
  ): Promise<SubscriptionResponse> {
    return this.account.subscription(tenant.id, tenant.planCode);
  }

  @Get('settings/preferences')
  @ApiOperation({
    summary: 'Preferências de prospecção',
    description:
      'Serviços vendidos, nichos, regiões, canal preferido e meta mensal. ' +
      'Nichos e regiões alimentam dois pesos do score: nicho prioritário (+15) ' +
      'e região atendida (+5).',
  })
  async preferences(@CurrentTenant() tenant: ActiveTenant): Promise<PreferencesView> {
    return this.account.preferences(tenant.id);
  }

  @Patch('settings/preferences')
  @MinRole('MANAGER')
  @ApiOperation({
    summary: 'Salvar preferências',
    description:
      'Grava as preferências e devolve `scoreAffected: true` quando nichos ou ' +
      'regiões mudaram — sinal para a interface oferecer o recálculo. Não ' +
      'recalcula sozinho: a base pode ter milhares de leads e a reordenação ' +
      'muda a prioridade que a pessoa está usando naquele momento. ' +
      'Exige papel MANAGER ou superior. Grava AuditLog com antes e depois.',
  })
  @ApiResponse({ status: 200, description: 'Preferências salvas' })
  @ApiResponse({ status: 403, description: 'Papel insuficiente' })
  async updatePreferences(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.account.updatePreferences(tenant.id, user.id, dto);
  }

  @Patch('settings/segment')
  @MinRole('MANAGER')
  @ApiOperation({
    summary: 'Definir segmento de atuação',
    description:
      'Escolhe o segmento do tenant na taxonomia. Com `applyDefaults`, soma os ' +
      'serviços e setores sugeridos aos já cadastrados — **soma, não ' +
      'substitui**: trocar de segmento não pode apagar em silêncio a lista que ' +
      'a pessoa ajustou à mão. Enviar `segmentId: null` desassocia.',
  })
  @ApiResponse({ status: 404, description: 'Segmento inexistente' })
  async setSegment(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetSegmentDto,
  ): Promise<PreferencesView> {
    return this.account.setSegment(
      tenant.id,
      user.id,
      dto.segmentId ?? null,
      dto.applyDefaults ?? false,
    );
  }

  @Post('settings/onboarding/complete')
  @ApiOperation({
    summary: 'Concluir onboarding',
    description:
      'Marca o onboarding do tenant como concluído. Transição explícita, não ' +
      'efeito colateral de salvar preferências. Idempotente: reconcluir mantém ' +
      'a data original. Grava AuditLog.',
  })
  @ApiResponse({ status: 201, description: 'Estado do onboarding' })
  async completeOnboarding(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreferencesView> {
    return this.account.completeOnboarding(tenant.id, user.id);
  }

  @Post('settings/onboarding/restart')
  @MinRole('MANAGER')
  @ApiOperation({
    summary: 'Refazer onboarding',
    description:
      'Limpa a data de conclusão sem apagar as preferências — quem refaz quer ' +
      'rever as perguntas, não perder as respostas. Exige MANAGER ou superior. ' +
      'Grava AuditLog.',
  })
  @ApiResponse({ status: 201, description: 'Estado do onboarding' })
  @ApiResponse({ status: 403, description: 'Papel insuficiente' })
  async restartOnboarding(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PreferencesView> {
    return this.account.restartOnboarding(tenant.id, user.id);
  }

  @Post('settings/recalculate-scores')
  @MinRole('MANAGER')
  @ApiOperation({
    summary: 'Recalcular score de toda a base',
    description:
      'Aplica o motor determinístico a todos os leads do tenant com as ' +
      'preferências vigentes. Mesma função usada pelo worker e pelo seed. ' +
      'Regrava os motivos e a versão do algoritmo.',
  })
  @ApiResponse({ status: 201, description: 'Quantidade de leads recalculados' })
  async recalculate(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.account.recalculateAllScores(tenant.id, user.id);
  }
}
