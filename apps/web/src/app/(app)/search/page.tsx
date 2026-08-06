import type { SearchQuotaResponse } from '@propectai/types';
import type { Metadata } from 'next';

import { SearchForm } from '@/components/search/search-form';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Nova Busca' };

export default async function SearchPage() {
  // Consultar o saldo não dispara bloqueio: o gate só age quando o usuário
  // tenta criar uma busca sem crédito.
  const quota = await serverApi<SearchQuotaResponse>('/prospecting/quota');

  return (
    <>
      <PageHeader
        title="Nova Busca"
        subtitle="Encontre negócios locais com oportunidades de venda."
      />

      <SearchForm quota={quota} />
    </>
  );
}
