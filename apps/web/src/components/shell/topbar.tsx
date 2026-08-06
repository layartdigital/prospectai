'use client';

import { ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { NotificationBell } from '@/components/shell/notification-bell';

/** Rotulo exibido na trilha para cada rota da v0.1.1. */
const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'Visão Geral',
  '/search': 'Nova Busca',
  '/leads': 'Meus Leads',
  '/pipeline': 'Pipeline',
  '/history': 'Histórico',
  '/notifications': 'Avisos',
  '/ai-outreach': 'IA de Abordagem',
  '/pricing-calculator': 'Precificador',
  '/proposals': 'Propostas',
  '/contracts': 'Contratos',
  '/subscription': 'Assinatura',
  '/settings': 'Configurações',
  '/help': 'Ajuda',
};

interface TopbarProps {
  planCode?: string;
  userName?: string;
  userEmail?: string;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Topbar({
  planCode = 'FREE',
  userName = 'Demonstração',
  userEmail = 'owner@demo.propectai.local',
}: TopbarProps) {
  const pathname = usePathname();
  const base = `/${pathname.split('/').filter(Boolean)[0] ?? 'dashboard'}`;
  const label = ROUTE_LABELS[base] ?? 'Visão Geral';

  return (
    <header className="sticky top-0 z-20 flex h-topbar items-center justify-between border-b border-line bg-surface px-5">
      <nav aria-label="Trilha de navegação" className="flex items-center gap-1.5">
        <span className="text-label uppercase tracking-wide text-muted">PropectAI</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        <span className="text-[13px] font-medium text-navy-900">{label}</span>
      </nav>

      <div className="flex items-center gap-3">
        <NotificationBell />

        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {planCode}
        </span>

        <div className="flex items-center gap-2.5">
          <div className="hidden text-right sm:block">
            <p className="text-[13px] font-semibold leading-tight text-navy-900">
              {userName}
            </p>
            <p className="text-[11px] leading-tight text-muted">{userEmail}</p>
          </div>
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white"
          >
            {initials(userName)}
          </div>
        </div>
      </div>
    </header>
  );
}
