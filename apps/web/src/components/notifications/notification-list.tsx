'use client';

import type { NotificationListResponse, NotificationType } from '@propectai/types';
import { CheckCheck, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { cn, formatDateTime } from '@/lib/utils';

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function NotificationList({
  initial,
  labels,
  severity,
}: {
  initial: NotificationListResponse;
  labels: Record<NotificationType, string>;
  severity: Record<NotificationType, 'info' | 'success' | 'warning' | 'danger'>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [busy, setBusy] = useState(false);

  const unread = items.filter((item) => item.readAt === null).length;

  async function markRead(id: string): Promise<void> {
    // Otimista: o aviso perde o destaque na hora.
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );

    try {
      await clientApi(`/notifications/${id}/read`, { method: 'PATCH' });
      router.refresh();
    } catch {
      setItems(initial.items);
    }
  }

  async function markAllRead(): Promise<void> {
    if (busy || unread === 0) return;
    setBusy(true);

    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? now })),
    );

    try {
      await clientApi('/notifications/read-all', { method: 'POST' });
      router.refresh();
    } catch {
      setItems(initial.items);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pa-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-card-title text-navy-900">
          {items.length} {items.length === 1 ? 'aviso' : 'avisos'}
        </h2>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={unread === 0 || busy}
          className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Marcar todos como lidos
        </button>
      </div>

      <ul className="divide-y divide-line">
        {items.map((item) => {
          const isUnread = item.readAt === null;

          return (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-3 px-4 py-3 transition-colors',
                isUnread ? 'bg-brand-50/40' : 'hover:bg-surface-soft/60',
              )}
            >
              <span
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  isUnread ? SEVERITY_DOT[severity[item.type]] : 'bg-line',
                )}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      'text-[13px] text-navy-900',
                      isUnread && 'font-semibold',
                    )}
                  >
                    {item.title}
                  </p>
                  <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                    {labels[item.type]}
                  </span>
                </div>

                {item.body ? (
                  <p className="mt-0.5 text-xs text-muted">{item.body}</p>
                ) : null}

                <p className="mt-1 text-[11px] text-muted">
                  {formatDateTime(item.createdAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Link só quando o payload permite montar um destino real.
                    Aviso que não leva a lugar nenhum é ruído. */}
                {item.href ? (
                  <Link
                    href={item.href}
                    onClick={() => void markRead(item.id)}
                    className="inline-flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-navy-900 hover:border-brand-600 hover:text-brand-600"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    Abrir
                  </Link>
                ) : null}

                {isUnread ? (
                  <button
                    type="button"
                    onClick={() => void markRead(item.id)}
                    className="rounded-control px-2 py-1 text-xs text-muted hover:text-navy-900"
                  >
                    Marcar lido
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
