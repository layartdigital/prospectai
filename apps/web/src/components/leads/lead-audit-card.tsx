'use client';

import type { AuditListItem, AuditQuotaView } from '@propectai/types';
import { Gauge, Loader2, Lock, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';
import { formatDateTime } from '@/lib/utils';

interface Props {
  leadId: string;
  /** `Lead.website`. Nulo significa que nao ha o que auditar. */
  website: string | null;
  saldo: AuditQuotaView;
  auditorias: AuditListItem[];
}

/** Os tres estados em que a auditoria ainda nao terminou. */
const EM_ANDAMENTO = new Set<AuditListItem['status']>(['REQUESTED', 'QUEUED', 'RUNNING']);

/**
 * O rotulo de cada estado, e o cuidado esta no `FAILED`.
 *
 * `AuditStatus.FAILED` **nao** e "o site reprovou" — e "nos nao conseguimos
 * medir". A distincao esta escrita no `site-audit.ts` e confundi-la aqui seria
 * pior que no banco: o operador leria defeito nosso como achado do cliente, e
 * poderia leva-lo para uma conversa de venda.
 */
const ROTULO: Record<AuditListItem['status'], string> = {
  REQUESTED: 'Na fila',
  QUEUED: 'Na fila',
  RUNNING: 'Medindo',
  COMPLETED: 'Concluída',
  PARTIAL: 'Concluída em parte',
  FAILED: 'Não foi possível medir',
  CANCELLED: 'Cancelada',
};

/**
 * De quanto em quanto tempo a tela reconsulta enquanto ha auditoria correndo,
 * e quantas vezes no maximo.
 *
 * **O teto existe porque o caminho de desenvolvimento nao tem worker.** Sem ele
 * uma auditoria que ficasse `QUEUED` para sempre — worker parado, fila em outro
 * prefixo — deixaria a aba consultando o servidor indefinidamente, sem nada na
 * tela dizendo que parou de valer a pena esperar. Dois minutos e mais que o
 * suficiente para uma auditoria real, que roda em segundos.
 */
const INTERVALO_MS = 4_000;
const MAXIMO_DE_CONSULTAS = 30;

export function LeadAuditCard({ leadId, website, saldo, auditorias }: Props) {
  const router = useRouter();

  const [pedindo, setPedindo] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desistiu, setDesistiu] = useState(false);

  const consultas = useRef(0);

  const emAndamento = auditorias.some((a) => EM_ANDAMENTO.has(a.status));

  useEffect(() => {
    if (!emAndamento || desistiu) return;

    const timer = setInterval(() => {
      consultas.current += 1;

      if (consultas.current >= MAXIMO_DE_CONSULTAS) {
        setDesistiu(true);
        return;
      }

      router.refresh();
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [emAndamento, desistiu, router]);

  async function pedir(): Promise<void> {
    if (pedindo) return;

    setPedindo(true);
    setErro(null);
    setBloqueado(false);

    try {
      await clientApi('/audits', {
        method: 'POST',
        body: JSON.stringify({ leadId }),
      });

      // Auditoria nova reabre a janela de espera: o teto conta por pedido, e
      // nao pela vida da pagina.
      consultas.current = 0;
      setDesistiu(false);
      router.refresh();
    } catch (caught) {
      // O bloqueio de plano so aparece AQUI, depois do clique — regra 5.
      // Carregar a ficha nunca dispara paywall.
      if (caught instanceof ClientApiError && caught.code === 'PLAN_LIMIT') {
        setBloqueado(true);
        setErro(caught.message);
        return;
      }
      setErro(caught instanceof Error ? caught.message : 'Não foi possível pedir');
    } finally {
      setPedindo(false);
    }
  }

  return (
    <section className="pa-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-card-title text-navy-900">
          <Gauge className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Presença digital
        </h2>
        {/* Consultar o saldo nunca bloqueia. O numero aparece igual no FREE. */}
        <span className="text-[11px] text-muted">
          {saldo.disponivel} de {saldo.incluidas}{' '}
          {saldo.incluidas === 1 ? 'diagnóstico' : 'diagnósticos'} neste mês
        </span>
      </div>

      <div className="p-4">
        <p className="mb-3 text-xs text-muted">
          Verificamos o site cadastrado: se o endereço existe, se ele abre, se
          tem certificado de segurança válido e se quem digita sem{' '}
          <code className="text-[11px]">https</code> chega à versão protegida.
          Cada item traz o que foi observado e quando.
        </p>

        {website === null ? (
          /* Botao que nao pode funcionar e pior que botao ausente — mesma
             escolha do WhatsApp em `lead-quick-actions.tsx`. Aqui nao e
             limite de plano: e ausencia de dado, e o texto diz qual. */
          <p className="pa-signal-unknown inline-block px-3 py-1.5 text-xs">
            Sem site cadastrado — não há endereço para verificar
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void pedir()}
            disabled={pedindo}
            className="inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pedindo ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Gauge className="h-4 w-4" aria-hidden="true" />
            )}
            {pedindo ? 'Pedindo…' : 'Verificar presença digital'}
          </button>
        )}

        {/* Bloqueio contextualizado, onde o resultado apareceria — nunca modal
            sobre a tela inteira. */}
        {bloqueado ? (
          <div className="mt-4 rounded-card border border-warning/30 bg-warning/5 p-3">
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

        {auditorias.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {auditorias.map((a) => {
              const correndo = EM_ANDAMENTO.has(a.status);
              const simulada =
                !correndo && a.providerName !== null && a.providerName !== 'native';

              return (
                <li
                  key={a.auditId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                >
                  <span className="flex items-center gap-2 text-navy-900">
                    {correndo ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-brand-600"
                        aria-hidden="true"
                      />
                    ) : null}
                    {ROTULO[a.status]}
                    {simulada ? (
                      /* Medicao simulada precisa ser visivel: o schema registra
                         que medido e inventado ja ficaram indistinguiveis tres
                         vezes, e foi preciso um campo para separa-los. */
                      <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] uppercase text-muted">
                        simulada
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted">
                    {formatDateTime(a.finishedAt ?? a.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {desistiu ? (
          <p className="mt-3 text-[11px] text-muted">
            A verificação ainda não terminou. Paramos de consultar para não
            ocupar a tela à toa — atualize a página para ver o resultado.
          </p>
        ) : null}
      </div>
    </section>
  );
}
