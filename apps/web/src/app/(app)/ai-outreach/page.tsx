import type { LeadListResponse, OutreachQuotaView } from '@propectai/types';
import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { OutreachWorkbench } from '@/components/outreach/outreach-workbench';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'IA de Abordagem' };

export default async function AiOutreachPage() {
  // Ordenados por score: a fila de abordagem deve começar por quem tem
  // mais chance de responder, não por ordem alfabética.
  const [leads, quota] = await Promise.all([
    serverApi<LeadListResponse>('/leads?pageSize=100&sortBy=score&sortDir=desc'),
    serverApi<OutreachQuotaView>('/ai/outreach/quota'),
  ]);

  return (
    <>
      <PageHeader
        title="IA de Abordagem"
        subtitle="Gere mensagens personalizadas para vários leads em sequência."
      />

      {leads.items.length === 0 ? (
        <div className="pa-card">
          <EmptyState
            icon={Sparkles}
            title="Nenhum lead para abordar"
            description="Faça uma busca para começar a gerar abordagens."
          />
        </div>
      ) : (
        <OutreachWorkbench leads={leads.items} quota={quota} />
      )}
    </>
  );
}
