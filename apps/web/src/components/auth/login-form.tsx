'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Trava contra submit nativo antes da hidratação.
   *
   * Enquanto o React não hidrata, `onSubmit` não existe e o navegador executa
   * o comportamento padrão do formulário: GET para a própria URL com todos os
   * campos que têm `name`. Isso coloca **a senha na query string** — que vai
   * para o histórico do navegador, o log de acesso do servidor e o cabeçalho
   * Referer.
   *
   * Descoberto em 31/07/2026 pelo E2E, que clica mais rápido que qualquer
   * pessoa. Mas não é artefato de teste: conexão lenta e Enter apressado
   * reproduzem o mesmo caminho.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Proteção contra clique duplo em ação assíncrona.
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Necessário para o navegador aceitar os cookies HttpOnly da API.
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[] }
          | null;
        const message = Array.isArray(body?.message)
          ? body.message[0]
          : body?.message;
        setError(message ?? 'Não foi possível entrar. Tente novamente.');
        return;
      }

      const next = searchParams.get('next');
      router.push(next && next.startsWith('/') ? next : '/dashboard');
      router.refresh();
    } catch {
      setError('Não foi possível falar com o servidor. A API está rodando?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="pa-label mb-1.5 block">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
          placeholder="voce@empresa.com.br"
        />
      </div>

      <div>
        <label htmlFor="password" className="pa-label mb-1.5 block">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !hydrated}
        className="flex w-full items-center justify-center gap-2 rounded-control bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Entrando…
          </>
        ) : (
          'Entrar'
        )}
      </button>
    </form>
  );
}
