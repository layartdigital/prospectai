import type { Metadata } from 'next';
import Link from 'next/link';

import { RegisterForm } from '@/components/auth/register-form';
import { Logo } from '@/components/shell/logo';

export const metadata: Metadata = { title: 'Criar conta' };

/**
 * Rota pública, já declarada em PUBLIC_ROUTES no middleware desde a Fase 2.
 * Até 31/07/2026 a declaração existia sem a página: visitante que chegasse
 * aqui recebia 404 em vez do cadastro.
 */
export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-appbg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="text-xl" />
          <p className="mt-2 text-sm text-muted">Prospecção de clientes locais.</p>
        </div>

        <div className="pa-card p-6">
          <h1 className="text-lg font-semibold text-navy-900">Criar conta</h1>
          <p className="mt-1 text-sm text-muted">
            Leva um minuto. O plano gratuito não pede cartão.
          </p>

          <RegisterForm />
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Já tem conta?{' '}
          <Link
            href="/login"
            className="rounded font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
          >
            Entrar
          </Link>
        </p>

        <p className="mt-3 text-center text-[11px] text-muted">
          PropectAI v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.1'}
        </p>
      </div>
    </main>
  );
}
