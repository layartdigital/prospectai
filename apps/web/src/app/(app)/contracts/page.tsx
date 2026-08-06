import type { ContractListResponse, ProposalListResponse } from '@propectai/types';
import type { Metadata } from 'next';

import { ContractsBoard } from '@/components/proposals/contracts-board';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Contratos' };

export default async function ContractsPage() {
  const [contracts, proposals] = await Promise.all([
    serverApi<ContractListResponse>('/contracts'),
    serverApi<ProposalListResponse>('/proposals'),
  ]);

  return (
    <>
      <PageHeader
        title="Contratos"
        subtitle="Acompanhe o que já foi assinado e o que está pendente."
      />

      <ContractsBoard initial={contracts} proposals={proposals.items} />
    </>
  );
}
