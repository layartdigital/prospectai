import { redirect } from 'next/navigation';

import { AppFooter } from '@/components/shell/app-footer';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { getSession } from '@/lib/session';

/**
 * App Shell.
 *
 * Sidebar fixa de 176px em desktop, topbar de 60px, fundo azul-acinzentado.
 * Nenhuma tela depende de largura fixa: abaixo de lg a sidebar sai do fluxo
 * e o conteúdo ocupa a largura inteira.
 *
 * A sessão é resolvida aqui, no servidor. O middleware já barra quem não tem
 * cookie, mas ele só olha a presença — a validação real acontece na API.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-appbg">
      <Sidebar />

      <div className="flex min-h-screen flex-col lg:pl-sidebar">
        <Topbar
          planCode={session.tenant?.planCode ?? 'FREE'}
          userName={session.user.name}
          userEmail={session.user.email}
        />

        <main className="flex-1 px-5 py-6">{children}</main>

        <AppFooter />
      </div>
    </div>
  );
}
