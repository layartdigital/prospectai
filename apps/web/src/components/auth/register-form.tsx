'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

/** Espelha o MinLength(10) do RegisterDto. Se mudar lá, muda aqui. */
const MIN_PASSWORD_LENGTH = 10;

export function RegisterForm() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Mesma trava do login: sem hidratação, o navegador faz GET com os campos na
   * query string — e aqui vazariam senha, e-mail e nome do workspace de uma vez.
   * Ver comentário em login-form.tsx.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Proteção contra clique duplo em ação assíncrona.
    if (submitting) return;

    // Validação local só para evitar ida ao servidor com erro óbvio. A regra
    // que vale é a do RegisterDto — esta aqui é conveniência, não autoridade.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Necessário para o navegador aceitar os cookies HttpOnly da API.
        credentials: 'include',
        body: JSON.stringify({ name, tenantName, email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string | string[] }
          | null;
        const message = Array.isArray(body?.message) ? body.message[0] : body?.message;

        // 409 é o único caso em que ser específico ajuda sem entregar
        // informação: quem tenta criar conta com um e-mail já cadastrado
        // precisa saber que o caminho é entrar, não insistir no cadastro.
        if (response.status === 409) {
          setError(message ?? 'Este e-mail já tem conta. Tente entrar.');
          return;
        }

        setError(message ?? 'Não foi possível criar a conta. Tente novamente.');
        return;
      }

      // O register já abre sessão: os cookies vieram nesta resposta.
      //
      // Vai para o onboarding, não para o dashboard: dashboard de tenant sem
      // nenhum lead é a pior primeira tela possível. O wizard termina em
      // /search, que é onde a conta nova de fato começa a usar o produto.
      router.push('/onboarding');
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
        <label htmlFor="name" className="pa-label mb-1.5 block">
          Seu nome
        </label>
        <input
          id="name"
          name="name"
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

      <div>
        <label htmlFor="tenantName" className="pa-label mb-1.5 block">
          Nome do workspace
        </label>
        <input
          id="tenantName"
          name="tenantName"
          type="text"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={120}
          value={tenantName}
          onChange={(event) => setTenantName(event.target.value)}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
          placeholder="Sua agência ou empresa"
        />
        <p className="mt-1 text-[11px] text-muted">
          É o espaço onde seus leads ficam. Dá para convidar sua equipe depois.
        </p>
      </div>

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
          maxLength={160}
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
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby="password-hint"
          aria-invalid={passwordTooShort || undefined}
          className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
          placeholder="••••••••••"
        />
        <p
          id="password-hint"
          className={`mt-1 text-[11px] ${passwordTooShort ? 'text-warning' : 'text-muted'}`}
        >
          Pelo menos {MIN_PASSWORD_LENGTH} caracteres.
          {passwordTooShort ? ` Faltam ${MIN_PASSWORD_LENGTH - password.length}.` : ''}
        </p>
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
            Criando conta…
          </>
        ) : (
          'Criar conta'
        )}
      </button>
    </form>
  );
}
