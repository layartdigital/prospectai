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

    // Um bloco para as tres. Ver a nota do `dashboard.service.ts`: serializar
    // custa menos que abrir uma transacao por consulta.
    const [items, total, unreadCount] = await this.prisma.comTenant(tenantId, (tx) =>
      Promise.all([
        tx.notification.findMany({
          where,
          orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
          take: options.take ?? 50,
        }),
        tx.notification.count({ where: { tenantId } }),
        tx.notification.count({ where: { tenantId, readAt: null } }),
      ]),
    );

    return {
      items: items.map((item) => this.toView(item)),
      unreadCount,
      total,
    };
  }

  async unreadCount(tenantId: string): Promise<{ count: number }> {
    const count = await this.prisma.comTenant(tenantId, (tx) =>
      tx.notification.count({ where: { tenantId, readAt: null } }),
    );
    return { count };
  }

  async markRead(tenantId: string, id: string): Promise<NotificationView> {
    /**
     * Ler e escrever no mesmo bloco.
     *
     * Aqui o `comTenant` nao e so contexto: as duas operacoes viram atomicas, e
     * some a janela entre conferir que o aviso e deste tenant e grava-lo. O
     * `update` abaixo usa `where: { id }` puro — hoje isso e seguro porque o
     * `findFirst` acima ja conferiu o tenant, e sob a politica passa a ser
     * seguro pelo banco.
     */
    const updated = await this.prisma.comTenant(tenantId, async (tx) => {
      const existing = await tx.notification.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Aviso não encontrado');

      return tx.notification.update({
        where: { id },
        // Idempotente: reler um aviso já lido não muda a data original.
        data: { readAt: existing.readAt ?? new Date() },
      });
    });

    return this.toView(updated);
  }

  async markAllRead(tenantId: string): Promise<{ updated: number }> {
    const result = await this.prisma.comTenant(tenantId, (tx) =>
      tx.notification.updateMany({
        where: { tenantId, readAt: null },
        data: { readAt: new Date() },
      }),
    );

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
