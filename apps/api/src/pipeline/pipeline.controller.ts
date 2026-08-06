import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HistoryResponse, PipelineBoard } from '@propectai/types';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

import { CurrentTenant, CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant, AuthenticatedUser } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { PipelineService } from './pipeline.service';

export class MoveCardDto {
  @IsString()
  @MaxLength(60)
  stageSlug!: string;

  @IsInt()
  @Min(0)
  position!: number;
}

@ApiTags('pipeline')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard)
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('pipeline')
  @ApiOperation({
    summary: 'Quadro do pipeline',
    description:
      'Colunas com os cards do tenant ativo, ordenadas por etapa e posição. ' +
      'Visualizar o quadro não exige plano pago — o gate, quando existir, ' +
      'incide sobre mover cards, não sobre ver.',
  })
  @ApiResponse({ status: 200, description: 'Colunas e cards' })
  async board(@CurrentTenant() tenant: ActiveTenant): Promise<PipelineBoard> {
    return this.pipeline.board(tenant.id);
  }

  @Patch('pipeline/cards/:id/move')
  @ApiOperation({
    summary: 'Mover card',
    description:
      'Atualiza etapa e posição. Quando a etapa muda, grava PipelineTransition ' +
      'com autor e origem, e gera LeadActivity. A interface aplica a mudança ' +
      'de forma otimista e desfaz se este endpoint falhar.',
  })
  @ApiResponse({ status: 200, description: 'Card movido' })
  @ApiResponse({ status: 404, description: 'Card ou etapa não encontrada' })
  async move(
    @CurrentTenant() tenant: ActiveTenant,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MoveCardDto,
  ) {
    return this.pipeline.moveCard(
      tenant.id,
      id,
      user.id,
      dto.stageSlug,
      dto.position,
    );
  }

  @Get('prospecting/searches')
  @ApiOperation({
    summary: 'Histórico de buscas',
    description:
      'Últimas 50 prospecções com duração, duplicados e status do job. ' +
      'A taxa de duplicidade é calculada sobre o total devolvido pela fonte, ' +
      'não sobre os leads gravados.',
  })
  @ApiResponse({ status: 200, description: 'Histórico e indicadores' })
  async history(@CurrentTenant() tenant: ActiveTenant): Promise<HistoryResponse> {
    return this.pipeline.history(tenant.id);
  }
}
