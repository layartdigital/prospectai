'use client';

import {
  ROLE_LABELS,
  type InvitationView,
  type Role,
  type TeamView,
} from '@propectai/types';
import { Check, Copy, Loader2, Lock, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';
import { formatDateTime } from '@/lib/utils';

const PAPEIS_ATRIBUIVEIS: Role[] = ['ADMIN', 'MANAGER', 'SDR', 'VIEWER'];

export function TeamManager({ initial }: { initial: TeamView }) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Role>('SDR');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [convite, setConvite] = useState<InvitationView | null>(null);
  const [copiado, setCopiado] = useState(false);

  const semAssento = initial.seatsUsed >= initial.seatsIncluded;

  async function executar(acao: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErro(null);
    setBloqueado(false);

    try {
      await acao();
      router.refresh();
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.code === 'PLAN_LIMIT') {
        setBloqueado(true);
        setErro(caught.message);
        return;
      }
      setErro(caught instanceof Error ? caught.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ---- Convidar ---------------------------------------------------- */}
      <section className="pa-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-card-title text-navy-900">Convidar pessoa</h2>
            <p className="mt-1 text-xs text-muted">
              {initial.seatsUsed} de {initial.seatsIncluded}{' '}
              {initial.seatsIncluded === 1 ? 'assento ocupado' : 'assentos ocupados'}.
              Convite pendente também ocupa assento.
            </p>
          </div>
        </div>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void executar(async () => {
              const criado = await clientApi<InvitationView>('/team/invitations', {
                method: 'POST',
                body: JSON.stringify({ email, role: papel }),
              });
              setConvite(criado);
              setCopiado(false);
              setEmail('');
            });
          }}
        >
          <div className="min-w-[240px] flex-1">
            <label htmlFor="convite-email" className="pa-label mb-1.5 block">
              E-mail
            </label>
            <input
              id="convite-email"
              type="email"
              required
              maxLength={160}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="pessoa@empresa.com.br"
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-muted"
            />
          </div>

          <div className="min-w-[180px]">
            <label htmlFor="convite-papel" className="pa-label mb-1.5 block">
              Papel
            </label>
            <select
              id="convite-papel"
              value={papel}
              onChange={(event) => setPapel(event.target.value as Role)}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-navy-900"
            >
              {PAPEIS_ATRIBUIVEIS.map((valor) => (
                <option key={valor} value={valor}>
                  {ROLE_LABELS[valor].label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-1.5 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            )}
            Convidar
          </button>
        </form>

        <p className="mt-2 text-[11px] text-muted">
          {ROLE_LABELS[papel].description}
        </p>

        {/*
          O aviso de assento esgotado aparece ao carregar porque é informação,
          não bloqueio: o botão continua funcionando, e o gate só age depois da
          tentativa. Esconder o formulário impediria a pessoa de descobrir o
          limite antes de precisar dele.
        */}
        {semAssento && !bloqueado ? (
          <p className="mt-3 rounded-control bg-surface-soft px-3 py-2 text-xs text-muted">
            Os assentos do plano estão ocupados. Convidar mais gente exige upgrade.
          </p>
        ) : null}

        {bloqueado ? (
          <div className="mt-3 rounded-card border border-warning/30 bg-warning/5 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-navy-900">
              <Lock className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
              {erro}
            </p>
            <Link
              href="/subscription"
              className="mt-2 inline-block rounded-control bg-warning px-3 py-1.5 text-xs font-semibold text-white"
            >
              Ver planos
            </Link>
          </div>
        ) : erro ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {erro}
          </p>
        ) : null}

        {/* ---- Link do convite -------------------------------------------
            Aparece uma única vez. O token é guardado como hash, então não há
            como recuperar o link depois — e isso precisa estar dito na tela,
            não só no código. */}
        {convite ? (
          <div className="mt-4 rounded-card border border-success/30 bg-success/5 p-3">
            <p className="text-xs font-semibold text-navy-900">
              Convite criado para {convite.email}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Não enviamos e-mail. Copie o link e mande pelo canal que preferir —
              ele aparece só desta vez e vale por sete dias.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-control bg-surface px-2 py-1.5 text-[11px] text-navy-900">
                {convite.acceptUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(convite.acceptUrl ?? '');
                  setCopiado(true);
                }}
                className="flex items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:border-brand-600"
              >
                {copiado ? (
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ---- Membros ----------------------------------------------------- */}
      <section className="pa-card">
        <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
          Membros
        </h2>

        <ul className="divide-y divide-line">
          {initial.members.map((membro) => (
            <li
              key={membro.membershipId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-navy-900">
                  {membro.name}
                  {membro.isYou ? (
                    <span className="ml-2 rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-medium text-muted">
                      você
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted">{membro.email}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Último acesso: {formatDateTime(membro.lastLoginAt)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label={`Papel de ${membro.name}`}
                  value={membro.role}
                  disabled={busy || membro.isYou}
                  onChange={(event) =>
                    void executar(() =>
                      clientApi(`/team/members/${membro.membershipId}/role`, {
                        method: 'PATCH',
                        body: JSON.stringify({ role: event.target.value }),
                      }),
                    )
                  }
                  className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs text-navy-900 disabled:opacity-60"
                >
                  {(['OWNER', ...PAPEIS_ATRIBUIVEIS] as Role[]).map((valor) => (
                    <option key={valor} value={valor}>
                      {ROLE_LABELS[valor].label}
                    </option>
                  ))}
                </select>

                {/* Alterar o próprio papel ou remover a si mesmo são as duas
                    formas mais fáceis de se trancar para fora. */}
                <button
                  type="button"
                  title="Remover acesso"
                  aria-label={`Remover ${membro.name}`}
                  disabled={busy || membro.isYou}
                  onClick={() =>
                    void executar(() =>
                      clientApi(`/team/members/${membro.membershipId}`, {
                        method: 'DELETE',
                      }),
                    )
                  }
                  className="rounded-control border border-line p-1.5 text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Convites pendentes ------------------------------------------ */}
      {initial.invitations.length > 0 ? (
        <section className="pa-card">
          <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
            Convites pendentes
          </h2>

          <ul className="divide-y divide-line">
            {initial.invitations.map((pendente) => (
              <li
                key={pendente.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-[13px] text-navy-900">{pendente.email}</p>
                  <p className="text-[11px] text-muted">
                    {ROLE_LABELS[pendente.role].label} · convidado por{' '}
                    {pendente.invitedByName ?? 'alguém que saiu'} · expira em{' '}
                    {formatDateTime(pendente.expiresAt)}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void executar(() =>
                      clientApi(`/team/invitations/${pendente.id}`, {
                        method: 'DELETE',
                      }),
                    )
                  }
                  className="rounded-control border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  Revogar
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
