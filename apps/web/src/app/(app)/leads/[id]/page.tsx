import type {
  LeadDetail,
  OutreachMessageView,
  OutreachQuotaView,
} from '@propectai/types';
import {
  ArrowLeft,
  Clock,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ScoreBadge, SignalBadge, WebsiteBadge, WhatsAppBadge } from '@/components/leads/badges';
import { LeadContactForm } from '@/components/leads/lead-contact-form';
import { LeadFollowUps } from '@/components/leads/lead-follow-ups';
import { LeadNoteComposer } from '@/components/leads/lead-note-composer';
import { LeadOutreachCard } from '@/components/leads/lead-outreach-card';
import { LeadPipelineSidebar } from '@/components/leads/lead-pipeline-sidebar';
import { LeadQuickActions } from '@/components/leads/lead-quick-actions';
import { RecalculateScoreButton } from '@/components/leads/recalculate-score-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ServerApiError, serverApi } from '@/lib/server-api';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ficha do lead' };

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
  PHONE: 'Ligação',
  IN_PERSON: 'Presencial',
  OTHER: 'Outro',
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let lead: LeadDetail;
  try {
    lead = await serverApi<LeadDetail>(`/leads/${id}`);
  } catch (error) {
    if (error instanceof ServerApiError && error.statusCode === 404) notFound();
    throw error;
  }

  // Consultar a cota não dispara bloqueio: o card aparece contextualizado
  // mesmo no FREE, e o gate só age depois de o usuário clicar em gerar.
  const [outreachQuota, outreachHistory] = await Promise.all([
    serverApi<OutreachQuotaView>('/ai/outreach/quota'),
    serverApi<OutreachMessageView[]>(`/ai/outreach/lead/${id}`),
  ]);

  return (
    <>
      <Link
        href="/leads"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-navy-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Voltar para Meus Leads
      </Link>

      {/* ---- Cabeçalho contextual ------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-page-title text-navy-900">
            {lead.isFavorite ? (
              <Star className="h-5 w-5 shrink-0 fill-warning text-warning" aria-label="Favorito" />
            ) : null}
            {lead.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {lead.category ?? 'Categoria não informada'}
            {lead.address.city ? ` · ${lead.address.city}, ${lead.address.stateUf}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <WebsiteBadge status={lead.websiteStatus} />
            <WhatsAppBadge status={lead.presence.whatsappStatus} />
            <SignalBadge
              state={lead.presence.hasInstagram}
              labelPresent="Instagram"
              labelAbsent="Sem Instagram"
              labelUnknown="Instagram não verificado"
            />
          </div>
        </div>

        <ScoreBadge value={lead.score.value} level={lead.score.level} className="text-sm" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---- Coluna principal --------------------------------------- */}
        <div className="space-y-4">
          <section className="pa-card">
            <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
              Informações de contato
            </h2>

            <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <Field icon={Phone} label="Telefone">
                <span className="font-mono">{lead.phone ?? 'Não encontrado'}</span>
                {lead.phoneIsMasked ? (
                  <span className="ml-2 text-[11px] text-warning">
                    parcialmente oculto no plano gratuito
                  </span>
                ) : null}
              </Field>

              <Field icon={Globe} label="Website">
                {lead.website ? (
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-brand-600 underline underline-offset-2"
                  >
                    {lead.website}
                  </a>
                ) : (
                  <span className="text-muted">Sem website</span>
                )}
              </Field>

              <Field icon={MapPin} label="Endereço">
                {lead.address.full ?? 'Não informado'}
              </Field>

              <Field icon={Mail} label="E-mail">
                {lead.email ?? <span className="text-muted">Não encontrado</span>}
              </Field>

              <Field icon={Star} label="Avaliações Google">
                {lead.reviewRating !== null ? (
                  <>
                    {lead.reviewRating.toFixed(1)}{' '}
                    <span className="text-muted">
                      ({lead.reviewCount ?? 0} avaliações)
                    </span>
                  </>
                ) : (
                  <span className="text-muted">Não encontrado</span>
                )}
              </Field>

              <Field icon={Clock} label="Última atualização dos dados">
                {formatDateTime(lead.tracking.lastEnrichedAt)}
              </Field>
            </dl>
          </section>

          {/* ---- Score explicável ------------------------------------- */}
          <section className="pa-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-card-title text-navy-900">Score de oportunidade</h2>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted">
                  {lead.score.algorithmVersion} ·{' '}
                  {formatDateTime(lead.score.calculatedAt)}
                </span>
                <RecalculateScoreButton leadId={lead.id} />
              </div>
            </div>

            <p className="px-4 pt-3 text-[11px] text-muted">
              O score é uma priorização comercial — em que ordem vale a pena abordar.
              Não é previsão de conversão.
            </p>

            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <ReasonList
                title="Pontos positivos"
                icon={TrendingUp}
                tone="text-success"
                reasons={lead.score.positives}
                empty="Nenhum ponto positivo identificado."
              />
              <ReasonList
                title="Pontos de atenção"
                icon={TrendingDown}
                tone="text-warning"
                reasons={lead.score.attentions}
                empty="Nenhum ponto de atenção identificado."
              />
            </div>
          </section>

          {/* ---- Ações rápidas ---------------------------------------- */}
          <section className="pa-card">
            <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
              Ações rápidas
            </h2>
            <div className="p-4">
              <LeadQuickActions
                leadId={lead.id}
                phone={lead.phone}
                phoneIsMasked={lead.phoneIsMasked}
                whatsappUrl={lead.whatsappUrl}
                mapsUrl={lead.address.mapsUrl}
                isFavorite={lead.isFavorite}
              />
            </div>
          </section>

          <LeadOutreachCard
            leadId={lead.id}
            quota={outreachQuota}
            history={outreachHistory}
          />

          {/* ---- Histórico de contatos -------------------------------- */}
          <section className="pa-card">
            <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
              Histórico de contatos
            </h2>

            <LeadContactForm leadId={lead.id} />

            {lead.contactRecords.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="Nenhum contato registrado"
                description="Registre ligações e mensagens para manter a linha do tempo do lead."
              />
            ) : (
              <ul className="divide-y divide-line">
                {lead.contactRecords.map((record) => (
                  <li key={record.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-navy-900">
                        {CHANNEL_LABELS[record.channel] ?? record.channel}
                      </span>
                      <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] text-muted">
                        {record.direction === 'SENT' ? 'Enviado' : 'Recebido'}
                      </span>
                      <span className="text-muted">
                        {formatDateTime(record.occurredAt)}
                      </span>
                      {record.authorName ? (
                        <span className="text-muted">· {record.authorName}</span>
                      ) : null}
                    </div>
                    {record.outcome ? (
                      <p className="mt-1 text-xs text-navy-900">{record.outcome}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- Follow-ups ------------------------------------------- */}
          <LeadFollowUps leadId={lead.id} items={lead.followUps} />
        </div>

        {/* ---- Sidebar ------------------------------------------------ */}
        <div className="space-y-4 xl:sticky xl:top-[76px] xl:self-start">
          <LeadPipelineSidebar
            leadId={lead.id}
            stages={lead.pipeline.stages}
            currentSlug={lead.pipeline.currentStageSlug}
          />

          <section className="pa-card">
            <h2 className="border-b border-line px-4 py-3 text-card-title text-navy-900">
              Acompanhamento
            </h2>

            <dl className="space-y-2.5 px-4 py-3 text-xs">
              <Row label="Responsável" value={lead.pipeline.ownerName ?? 'Não atribuído'} />
              <Row label="Última ação" value={formatDateTime(lead.tracking.lastActivityAt)} />
              <Row label="Último contato" value={formatDateTime(lead.tracking.lastContactedAt)} />
              <Row
                label="Próximo follow-up"
                value={formatDateTime(lead.tracking.nextFollowUpAt)}
              />
            </dl>

            <LeadNoteComposer leadId={lead.id} notes={lead.notes} />
          </section>
        </div>
      </div>
    </>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="pa-label">{label}</dt>
        <dd className="mt-0.5 text-[13px] text-navy-900">{children}</dd>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  );
}

function ReasonList({
  title,
  icon: Icon,
  tone,
  reasons,
  empty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  reasons: { code: string; label: string; weight: number; evidence: string | null }[];
  empty: string;
}) {
  return (
    <div>
      <h3 className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h3>

      {reasons.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {reasons.map((reason) => (
            <li key={reason.code} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-navy-900">{reason.label}</p>
                {/* A evidência é o que permite discordar de forma produtiva:
                    o usuário vê qual dado gerou a pontuação. */}
                {reason.evidence ? (
                  <p className="truncate text-[11px] text-muted">{reason.evidence}</p>
                ) : null}
              </div>
              <span className="shrink-0 font-mono text-xs text-muted">
                {reason.weight > 0 ? `+${reason.weight}` : reason.weight}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
