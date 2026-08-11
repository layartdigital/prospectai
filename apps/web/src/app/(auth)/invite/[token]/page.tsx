import type { InvitationPreview } from '@propectai/types';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AcceptInviteForm } from '@/components/auth/accept-invite-form';
import { Logo } from '@/components/shell/logo';

export const metadata: Metadata = { title: 'Convite' };

const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101';

/**
 * Aceite de convite. Rota pública — quem foi convidado ainda não tem conta.
 *
 * Busca direta na API, sem `serverApi`, porque aquele helper pressupõe sessão
 * e trata 401 como redirecionamento para o login. Aqui não há sessão por
 * definição, e o 404 precisa virar mensagem, não desvio.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const response = await fetch(`${API_URL}/api/v1/invitations/${token}`, {
    cache: 'no-store',
  }).catch(() => null);

  const preview = response?.ok
    ? ((await response.json()) as InvitationPreview)
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-appbg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="text-xl" />
          <p className="mt-2 text-sm text-muted">Prospecção de clientes locais.</p>
        </div>

        <div className="pa-card p-6">
          {preview ? (
            <>
              <h1 className="text-lg font-semibold text-navy-900">
                Você foi convidado
              </h1>
              <p className="mt-1 text-sm text-muted">
                {preview.invitedByName ? `${preview.invitedByName} convidou você` : 'Convite'}{' '}
                para o workspace <strong className="text-navy-900">{preview.tenantName}</strong>.
              </p>

              <AcceptInviteForm token={token} preview={preview} />
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-navy-900">
                Convite indisponível
              </h1>
              {/* Uma mensagem só para inválido, expirado e já usado: distinguir
                  os três permitiria descobrir quais tokens existem. */}
              <p className="mt-2 text-sm text-muted">
                Este convite não é mais válido. Ele pode ter expirado, sido revogado
                ou já utilizado. Peça um novo a quem administra o workspace.
              </p>

              <Link
                href="/login"
                className="mt-5 inline-block rounded-control bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700"
              >
                Ir para o login
              </Link>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted">
          PropectAI v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.1'}
        </p>
      </div>
    </main>
  );
}
