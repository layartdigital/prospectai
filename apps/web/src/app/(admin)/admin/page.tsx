import type { AdminTenantList } from '@propectai/types';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TenantsTable } from '@/components/admin/tenants-table';
import { PageHeader } from '@/components/ui/page-header';
import { ServerApiError, serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Painel do provedor' };

/**
 * Lista de clientes da plataforma.
 *
 * O 403 é tratado aqui em vez de virar erro: quem não é operador vê a mesma
 * mensagem genérica que veria numa rota inexistente. Explicar que a página
 * existe mas o acesso foi negado orienta quem estiver procurando.
 */
export default async function AdminPage() {
  let data: AdminTenantList | null = null;

  try {
    data = await serverApi<AdminTenantList>('/admin/tenants');
  } catch (error) {
    if (!(error instanceof ServerApiError) || error.statusCode !== 403) throw error;
  }

  if (!data) {
    return (
      <div className="pa-card mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-navy-900">Recurso não disponível</h1>
        <p className="mt-2 text-sm text-muted">
          Esta área é restrita à operação da plataforma.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-block rounded-control bg-brand-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-700"
        >
          Voltar ao produto
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Plano, consumo e estado de cada workspace da plataforma."
      />

      <TenantsTable data={data} />
    </>
  );
}
