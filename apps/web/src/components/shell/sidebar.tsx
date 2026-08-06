'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LogoutButton } from '@/components/auth/logout-button';
import { Logo } from '@/components/shell/logo';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-control px-3 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'bg-navy-900 text-white'
          : 'text-muted hover:bg-surface-soft hover:text-navy-900',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-line bg-surface lg:flex',
      )}
    >
      <div className="flex h-topbar items-center px-4">
        <Link href="/dashboard" className="rounded-control">
          <Logo />
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 space-y-1 px-3 py-2">
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="space-y-1 border-t border-line px-3 py-3">
        {SECONDARY_NAV.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            active={item.label !== 'Fazer Upgrade' && isActive(item.href)}
          />
        ))}
        <LogoutButton />
      </div>
    </aside>
  );
}
