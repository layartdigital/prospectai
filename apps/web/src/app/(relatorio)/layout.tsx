import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

/**
 * O relatório de diagnóstico tem layout próprio, e isso é uma decisão e não um
 * detalhe de organização de pastas.
 *
 * **O relatório não é a aplicação com coisas escondidas — é outro documento.**
 * Ele sai daqui impresso ou em PDF, para a mão de alguém que não tem conta no
 * sistema e nunca vai ter. Sidebar, topbar com o plano do usuário, rodapé da
 * aplicação: nada disso pertence a uma página que vai virar anexo de e-mail.
 * Esconder tudo isso com `hidden` dentro do `(app)` daria o mesmo pixel e a
 * mesma dívida — a próxima pessoa a mexer no shell quebraria o documento sem
 * saber que ele existe.
 *
 * ---
 *
 * **Autenticado, apesar de ser um documento para terceiros.**
 *
 * O `matcher` do middleware protege tudo que não é asset estático, e só
 * `/login`, `/register` e `/invite` são públicos — então este grupo de rotas
 * nasce autenticado sem que se escreva uma linha. É o padrão certo: quem manda
 * o relatório é o usuário, e o link não é o meio de entrega. Uma rota pública
 * por token — para o prospecto abrir sem conta — é decisão comercial que ainda
 * não foi tomada, e construí-la antes seria adiantar estrutura para um cenário
 * que não existe.
 *
 * A sessão é resolvida aqui de novo, como no `(app)`: o middleware só olha a
 * presença do cookie; a validação real acontece na API.
 */
export default async function RelatorioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return <div className="min-h-screen bg-white">{children}</div>;
}
