import type { TeamView } from '@propectai/types';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TeamManager } from '@/components/team/team-manager';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Equipe' };

/**
 * Gestão de equipe do workspace.
 *
 * Fica sob Configurações, e não no menu principal: a regra do escopo é que só
 * entra no menu o que se usa no dia a dia. Convidar alguém acontece uma vez
 * por contratação, não toda manhã.
 */
export default async function TeamPage() {
  const team = await serverApi<TeamView>('/team');

  return (
    <>
      <Link
        href="/settings"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-navy-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Voltar para Configurações
      </Link>

      <PageHeader
        title="Equipe"
        subtitle="Quem tem acesso a este workspace e com qual papel."
      />

      <TeamManager initial={team} />
    </>
  );
}
