import type {
  PreferencesView,
  SearchQuotaResponse,
  SegmentDetail,
} from '@propectai/types';
import type { Metadata } from 'next';

import { SearchForm } from '@/components/search/search-form';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Nova Busca' };

export default async function SearchPage() {
  // Consultar o saldo não dispara bloqueio: o gate só age quando o usuário
  // tenta criar uma busca sem crédito.
  const [quota, preferences] = await Promise.all([
    serverApi<SearchQuotaResponse>('/prospecting/quota'),
    serverApi<PreferencesView>('/settings/preferences'),
  ]);

  /**
   * Termos do segmento, quando houver segmento escolhido.
   *
   * Falha não derruba a tela: sem sugestão, a busca continua funcionando com o
   * nicho digitado. Trocar uma conveniência por uma página de erro seria o
   * pior negócio possível — ainda mais porque este é o caminho que pode
   * disparar geração por IA, e depender de serviço externo para abrir a tela
   * principal do produto é fragilidade que ninguém pediu.
   */
  const segmento = preferences.segment
    ? await serverApi<SegmentDetail>(`/segments/${preferences.segment.id}`).catch(
        () => null,
      )
    : null;

  return (
    <>
      <PageHeader
        title="Nova Busca"
        subtitle="Encontre negócios locais com oportunidades de venda."
      />

      <SearchForm quota={quota} segmento={segmento} />
    </>
  );
}
