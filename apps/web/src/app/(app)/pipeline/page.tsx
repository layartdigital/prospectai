import type { PipelineBoard } from '@propectai/types';
import { KanbanSquare } from 'lucide-react';
import type { Metadata } from 'next';

import { PipelineBoardView } from '@/components/pipeline/pipeline-board';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const board = await serverApi<PipelineBoard>('/pipeline');

  return (
    <>
      <PageHeader
        title="Pipeline de Vendas"
        subtitle="Arraste os cards para mover leads entre etapas."
      />

      {board.total === 0 ? (
        <div className="pa-card">
          <EmptyState
            icon={KanbanSquare}
            title="Pipeline vazio"
            description="Adicione leads ao pipeline pela ficha de cada lead."
          />
        </div>
      ) : (
        <PipelineBoardView board={board} />
      )}
    </>
  );
}
