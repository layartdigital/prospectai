'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { clientApi } from '@/lib/client-api';

const POLL_MS = 60_000;

/**
 * Sino da topbar.
 *
 * Consulta apenas a contagem, não a lista — é a requisição mais frequente da
 * aplicação e não precisa trafegar payload. Revalida a cada minuto e a cada
 * troca de rota, sem WebSocket: o custo não se justifica para um contador que
 * pode atrasar sessenta segundos.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const result = await clientApi<{ count: number }>(
          '/notifications/unread-count',
        );
        if (active) setCount(result.count);
      } catch {
        // Contador indisponível não pode quebrar a topbar.
      }
    }

    void load();
    const timer = setInterval(() => void load(), POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pathname]);

  return (
    <Link
      href="/notifications"
      aria-label={
        count > 0 ? `Avisos: ${count} não lidos` : 'Avisos: nenhum não lido'
      }
      className="relative flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-soft hover:text-navy-900"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}
