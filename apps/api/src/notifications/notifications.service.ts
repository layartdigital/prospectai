import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationListResponse,
  NotificationType,
  NotificationView,
} from '@propectai/types';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    options: { onlyUnread?: boolean; take?: number } = {},
  ): Promise<NotificationListResponse> {
    const where = {
      tenantId,
      ...(options.onlyUnread ? { readAt: null } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
        take: options.take ?? 50,
      }),
      this.prisma.notification.count({ where: { tenantId } }),
      this.prisma.notification.count({ where: { tenantId, readAt: null } }),
    ]);

    return {
      items: items.map((item) => this.toView(item)),
      unreadCount,
      total,
    };
  }

  async unreadCount(tenantId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { tenantId, readAt: null },
    });
    return { count };
  }

  async markRead(tenantId: string, id: string): Promise<NotificationView> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Aviso não encontrado');

    const updated = await this.prisma.notification.update({
      where: { id },
      // Idempotente: reler um aviso já lido não muda a data original.
      data: { readAt: existing.readAt ?? new Date() },
    });

    return this.toView(updated);
  }

  async markAllRead(tenantId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * Monta o destino a partir do payload.
   *
   * Aviso que não leva a lugar nenhum é ruído. Quando o payload não tem
   * referência suficiente, `href` volta null e a interface não renderiza
   * um link morto.
   */
  private toView(item: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationView {
    const payload = (item.payload ?? {}) as { leadId?: string; searchId?: string };

    let href: string | null = null;
    if (payload.leadId) href = `/leads/${payload.leadId}`;
    else if (payload.searchId) href = '/history';
    else if (item.type === 'FOLLOWUP_OVERDUE') href = '/leads?minScore=0';
    else if (item.type === 'LIMIT_NEAR') href = '/subscription';

    return {
      id: item.id,
      type: item.type as NotificationType,
      title: item.title,
      body: item.body,
      href,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
