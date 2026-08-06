'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

/**
 * Sair não é um link.
 *
 * Encerrar sessão precisa revogar o refresh token no banco — apagar o cookie
 * sozinho deixaria um token válido em circulação até expirar.
 */
export function LogoutButton() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function handleLogout(): Promise<void> {
    if (leaving) return;
    setLeaving(true);

    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Mesmo sem resposta da API, tirar o usuário da aplicação é o correto.
    }

    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={leaving}
      className="flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-soft hover:text-navy-900 disabled:opacity-60"
    >
      <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{leaving ? 'Saindo…' : 'Sair'}</span>
    </button>
  );
}
