import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

/**
 * Layout do painel do provedor.
 *
 * Deliberadamente diferente do App Shell do produto: sem sidebar de navegação
 * do tenant, sem seletor de workspace, faixa escura no topo. Quem está aqui
 * enxerga todos os clientes, e a tela precisa deixar isso evidente — confundir
 * os dois planos é como se apaga o dado do cliente errado achando que está no
 * próprio workspace.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-appbg">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex h-topbar max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-semibold">Painel do provedor</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
              todos os clientes
            </span>
          </div>

          <Link
            href="/dashboard"
            className="rounded-control px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:text-white"
          >
            Voltar ao produto
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
