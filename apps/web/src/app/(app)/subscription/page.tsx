import type { SubscriptionResponse } from '@propectai/types';
import { Check, Minus } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';
import { formatInteger } from '@/lib/utils';

export const metadata: Metadata = { title: 'Assinatura' };

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Grátis';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function UsageBar({
  label,
  used,
  total,
}: {
  label: string;
  used: number;
  total: number;
}) {
  const share = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const near = share >= 80;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-navy-900">
          {formatInteger(used)} de {formatInteger(total)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
        <div
          className={`h-full rounded-full transition-all ${near ? 'bg-warning' : 'bg-brand-600'}`}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

export default async function SubscriptionPage() {
  const data = await serverApi<SubscriptionResponse>('/subscription');

  return (
    <>
      <PageHeader
        title="Assinatura"
        subtitle="Seu plano atual, o consumo do período e o que muda em cada nível."
      />

      <section className="pa-card mb-4 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-card-title text-navy-900">Consumo do período</h2>
          <span className="rounded-full bg-navy-900 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-white">
            {data.currentPlan}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <UsageBar
            label="Leads"
            used={data.usage.leadsUsed}
            total={data.usage.leadsIncluded}
          />
          <UsageBar
            label="Gerações de IA"
            used={data.usage.aiGenerationsUsed}
            total={data.usage.aiGenerationsIncluded}
          />
          <div>
            <p className="mb-1 text-xs text-muted">Buscas realizadas</p>
            <p className="text-lg font-bold text-navy-900">
              {formatInteger(data.usage.searchesCount)}
            </p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Leads duplicados não consomem crédito, e buscas que falham devolvem a
          reserva automaticamente.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((plan) => (
          <section
            key={plan.code}
            className={`pa-card flex flex-col p-5 ${
              plan.isCurrent ? 'border-brand-600 ring-1 ring-brand-600' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">
                {plan.name}
              </h2>
              {plan.isCurrent ? (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                  Atual
                </span>
              ) : null}
            </div>

            <p className="mt-3 text-2xl font-bold text-navy-900">
              {formatPrice(plan.priceCents, plan.currency)}
            </p>

            <ul className="mt-4 flex-1 space-y-2 text-xs">
              <Feature label={`${formatInteger(plan.limits.leadsIncluded)} leads incluídos`} on />
              <Feature
                label={`${formatInteger(plan.limits.searchesPerMonth)} buscas por mês`}
                on
              />
              <Feature
                label={
                  plan.limits.aiGenerationsPerMonth > 0
                    ? `${formatInteger(plan.limits.aiGenerationsPerMonth)} abordagens por IA`
                    : 'IA de abordagem'
                }
                on={plan.limits.aiGenerationsPerMonth > 0}
              />
              <Feature label="Pipeline comercial" on={plan.limits.pipelineEnabled} />
              <Feature
                label="Telefone completo"
                on={!plan.limits.maskPhones}
              />
              <Feature
                label={
                  plan.limits.exportFormats.length > 0
                    ? `Exportação ${plan.limits.exportFormats.join(' e ').toUpperCase()}`
                    : 'Exportação'
                }
                on={plan.limits.exportFormats.length > 0}
              />
              <Feature
                label={`${formatInteger(plan.limits.maxUsers)} ${plan.limits.maxUsers === 1 ? 'usuário' : 'usuários'}`}
                on
              />
            </ul>

            <button
              type="button"
              disabled={plan.isCurrent}
              className={`mt-5 w-full rounded-control px-4 py-2 text-xs font-semibold transition-colors ${
                plan.isCurrent
                  ? 'cursor-default bg-surface-soft text-muted'
                  : 'bg-navy-900 text-white hover:bg-navy-950'
              }`}
            >
              {plan.isCurrent ? 'Seu plano atual' : 'Falar sobre este plano'}
            </button>
          </section>
        ))}
      </div>

      {/* Honestidade sobre o estado real do produto vale mais do que um
          botão de compra que não compra nada. */}
      <p className="mt-4 rounded-card border border-dashed border-line px-4 py-3 text-xs text-muted">
        A contratação ainda não é automática nesta versão. O provedor de
        pagamento é uma abstração no código e nenhuma integração financeira foi
        ativada — trocar de plano hoje passa por contato direto.
      </p>
    </>
  );
}

function Feature({ label, on }: { label: string; on: boolean }) {
  return (
    <li
      className={`flex items-start gap-2 ${on ? 'text-navy-900' : 'text-muted line-through decoration-line'}`}
    >
      {on ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      )}
      {label}
    </li>
  );
}
