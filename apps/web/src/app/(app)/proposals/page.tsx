import type { LeadListResponse, ProposalListResponse } from '@propectai/types';
import type { Metadata } from 'next';

import { ProposalsBoard } from '@/components/proposals/proposals-board';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Propostas' };

export default async function ProposalsPage() {
  const [proposals, leads] = await Promise.all([
    serverApi<ProposalListResponse>('/proposals'),
    serverApi<LeadListResponse>('/leads?pageSize=100&sortBy=score&sortDir=desc'),
  ]);

  return (
    <>
      <PageHeader
        title="Propostas"
        subtitle="Crie propostas com itens e acompanhe o que virou negócio."
      />

      <ProposalsBoard initial={proposals} leads={leads.items} />
    </>
  );
}
