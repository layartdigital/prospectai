'use client';

import { ROLE_LABELS, type InvitationPreview } from '@propectai/types';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';
const MIN_PASSWORD_LENGTH = 10;

export function AcceptInviteForm({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mesma trava do login e do cadastro: sem hidratação, o navegador faria GET
  // com os campos na query string — e aqui vazaria a senha junto com o token
  // do convite. Ver comentário em login-form.tsx.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    if (!preview.userExists && password.length < MIN_PASSWORD_LENGTH) {
      setError(`A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          password,
          ...(preview.userExists ? {} : { name }),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[] }
          | null;
        const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
        setError(message ?? 'Não foi possível aceitar o convite.');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Não foi possível falar com o servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
      <div>
        <span className="pa-label mb-1.5 block">E-mail</span>
        {/* Não editável: o convite foi emitido para este endereço, e permitir
            troca transformaria o link num convite genérico. */}
        <p className="rounded-control border border-line bg-surface-soft px-3 py-2 text-sm text-navy-900">
          {preview.email}
        </p>
      </div>

      {preview.userExists ? (
        <p className="rounded-control bg-surface-soft px-3 py-2 text-xs text-muted">
          Já existe uma conta com este e-mail. Informe a senha dela para entrar no
          workspace — assim ninguém usa o link para anexar um workspace à conta de
          outra pessoa.
        </p>
      ) : (
        <div>
          <label htmlFor="name" className="pa-label mb-1.5 block">
            Seu nome
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
            placeholder="Como você quer ser chamado"
          />
        </div>
      )}

      <div>
        <label htmlFor="password" className="pa-label mb-1.5 block">
          {preview.userExists ? 'Sua senha atual' : 'Crie uma senha'}
        </label>
        <input
          id="password"
          type="password"
          autoComplete={preview.userExists ? 'current-password' : 'new-password'}
          required
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
          placeholder="••••••••••"
        />
        {!preview.userExists ? (
          <p className="mt-1 text-[11px] text-muted">
            Pelo menos {MIN_PASSWORD_LENGTH} caracteres. Quem convidou não vê sua senha.
          </p>
        ) : null}
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
          `Entrar como ${ROLE_LABELS[preview.role].label}`
        )}
      </button>
    </form>
  );
}
