import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { LoginForm } from '@/components/auth/login-form';
import { Logo } from '@/components/shell/logo';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-appbg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="text-xl" />
          <p className="mt-2 text-sm text-muted">
            Prospecção de clientes locais.
          </p>
        </div>

        <div className="pa-card p-6">
          <h1 className="text-lg font-semibold text-navy-900">Entrar</h1>
          <p className="mt-1 text-sm text-muted">
            Use as credenciais da sua conta.
          </p>

          {/* useSearchParams exige limite de Suspense no Next 15. */}
          <Suspense fallback={<div className="pa-skeleton mt-5 h-48 w-full" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Ainda não tem conta?{' '}
          <Link
            href="/register"
            className="rounded font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
          >
            Criar conta
          </Link>
        </p>

        <p className="mt-3 text-center text-[11px] text-muted">
          PropectAI v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.1'}
        </p>
      </div>
    </main>
  );
}
