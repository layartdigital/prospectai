import type { PreferencesView, VersionResponse } from '@propectai/types';
import type { Metadata } from 'next';

import { PreferencesForm } from '@/components/settings/preferences-form';
import { RestartOnboardingButton } from '@/components/settings/restart-onboarding-button';
import { PageHeader } from '@/components/ui/page-header';
import { getSession } from '@/lib/session';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Configurações' };

export default async function SettingsPage() {
  const [preferences, version, session] = await Promise.all([
    serverApi<PreferencesView>('/settings/preferences'),
    serverApi<VersionResponse>('/system/version'),
    getSession(),
  ]);

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Preferências de prospecção, conta e informações do sistema."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <PreferencesForm initial={preferences} />

        <div className="space-y-4">
          <section className="pa-card p-4">
            <h2 className="text-card-title text-navy-900">Conta</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <Row label="Nome" value={session?.user.name ?? '—'} />
              <Row label="E-mail" value={session?.user.email ?? '—'} />
              <Row label="Workspace" value={session?.tenant?.name ?? '—'} />
              <Row label="Papel" value={session?.tenant?.role ?? '—'} />
              <Row label="Plano" value={session?.tenant?.planCode ?? '—'} />
            </dl>
          </section>

          <section className="pa-card p-4">
            <h2 className="text-card-title text-navy-900">Sistema</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <Row label="Versão" value={`v${version.version}`} />
              <Row label="Ambiente" value={version.environment} />
              <Row
                label="Onboarding"
                value={preferences.completedAt ? 'Concluído' : 'Pendente'}
              />
            </dl>

            <RestartOnboardingButton completed={Boolean(preferences.completedAt)} />
          </section>

          <section className="pa-card p-4">
            <h2 className="text-card-title text-navy-900">Privacidade</h2>
            <p className="mt-2 text-xs text-muted">
              Avaliações do Google trazem nome, foto e link de perfil de pessoas
              físicas. Esses campos são descartados na normalização e nunca
              chegam ao banco — o produto guarda apenas a média e a contagem.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{value}</dd>
    </div>
  );
}
