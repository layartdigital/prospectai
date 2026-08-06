import {
  NOTIFICATION_LABELS,
  NOTIFICATION_SEVERITY,
  type NotificationListResponse,
} from '@propectai/types';
import { Bell } from 'lucide-react';
import type { Metadata } from 'next';

import { NotificationList } from '@/components/notifications/notification-list';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Avisos' };

export default async function NotificationsPage() {
  const data = await serverApi<NotificationListResponse>('/notifications');

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle={
          data.unreadCount > 0
            ? `${data.unreadCount} ${data.unreadCount === 1 ? 'aviso não lido' : 'avisos não lidos'}.`
            : 'Tudo em dia.'
        }
      />

      {data.items.length === 0 ? (
        <div className="pa-card">
          <EmptyState
            icon={Bell}
            title="Nenhum aviso ainda"
            description="Buscas concluídas, falhas de coleta e leads de score alto aparecem aqui."
          />
        </div>
      ) : (
        <NotificationList
          initial={data}
          labels={NOTIFICATION_LABELS}
          severity={NOTIFICATION_SEVERITY}
        />
      )}
    </>
  );
}
