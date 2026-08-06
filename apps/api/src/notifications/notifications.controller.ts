import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { NotificationListResponse } from '@propectai/types';

import { CurrentTenant } from '../common/decorators';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { ActiveTenant } from '../common/request-context';
import { TenantGuard } from '../common/tenant.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar avisos',
    description:
      'Não lidos primeiro, depois por data decrescente. O worker já grava ' +
      'avisos a cada busca concluída, falha e lead de score alto — este ' +
      'endpoint é onde eles finalmente ficam legíveis.',
  })
  @ApiQuery({ name: 'onlyUnread', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Avisos e contagem de não lidos' })
  async list(
    @CurrentTenant() tenant: ActiveTenant,
    @Query('onlyUnread') onlyUnread?: string,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(tenant.id, {
      onlyUnread: onlyUnread === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Contador de não lidos',
    description: 'Consumido pelo sino da topbar. Consulta barata, sem payload.',
  })
  async unreadCount(@CurrentTenant() tenant: ActiveTenant) {
    return this.notifications.unreadCount(tenant.id);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Marcar como lido',
    description: 'Idempotente: reler um aviso já lido preserva a data original.',
  })
  async markRead(
    @CurrentTenant() tenant: ActiveTenant,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(tenant.id, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Marcar todos como lidos' })
  async markAllRead(@CurrentTenant() tenant: ActiveTenant) {
    return this.notifications.markAllRead(tenant.id);
  }
}
