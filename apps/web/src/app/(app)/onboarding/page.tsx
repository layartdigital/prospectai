import type { PreferencesView } from '@propectai/types';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Primeiros passos' };

/**
 * Onboarding de 5 etapas, exigido pelo critério 6 da v0.1.1.
 *
 * Fica dentro de (app) de propósito: exige sessão, e as respostas pertencem ao
 * tenant. Quem já concluiu e volta pela URL é mandado ao dashboard — a porta de
 * entrada para refazer é o botão em Configurações, que zera a data de conclusão
 * sem apagar as respostas.
 */
export default async function OnboardingPage() {
  const preferences = await serverApi<PreferencesView>('/settings/preferences');

  if (preferences.completedAt) redirect('/dashboard');

  return (
    <div className="mx-auto w-full max-w-xl py-4">
      <div className="mb-5">
        <h1 className="text-page-title text-navy-900">Vamos configurar sua prospecção</h1>
        <p className="mt-1 text-sm text-muted">
          Cinco perguntas rápidas. Todas opcionais, todas alteráveis depois em
          Configurações.
        </p>
      </div>

      <OnboardingWizard initial={preferences} />
    </div>
  );
}
