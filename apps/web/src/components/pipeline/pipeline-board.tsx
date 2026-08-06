'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { PipelineBoard, PipelineCardView } from '@propectai/types';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ScoreBadge, WebsiteBadge } from '@/components/leads/badges';
import { clientApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

type Columns = Record<string, PipelineCardView[]>;

function toColumns(board: PipelineBoard): Columns {
  return Object.fromEntries(board.columns.map((column) => [column.slug, column.cards]));
}

export function PipelineBoardView({ board }: { board: PipelineBoard }) {
  const [columns, setColumns] = useState<Columns>(() => toColumns(board));
  const [dragging, setDragging] = useState<PipelineCardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Distância mínima evita que um clique no card vire drag acidental.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function findCard(cardId: string): { card: PipelineCardView; slug: string } | null {
    for (const [slug, cards] of Object.entries(columns)) {
      const card = cards.find((item) => item.id === cardId);
      if (card) return { card, slug };
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent): void {
    const found = findCard(String(event.active.id));
    setDragging(found?.card ?? null);
    setError(null);
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setDragging(null);

    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const targetSlug = String(over.id);

    const found = findCard(cardId);
    if (!found || found.slug === targetSlug) return;

    // Atualização otimista — o card move na hora.
    const snapshot = columns;
    const next: Columns = {
      ...columns,
      [found.slug]: columns[found.slug]?.filter((item) => item.id !== cardId) ?? [],
      [targetSlug]: [found.card, ...(columns[targetSlug] ?? [])],
    };
    setColumns(next);

    try {
      await clientApi(`/pipeline/cards/${cardId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ stageSlug: targetSlug, position: 0 }),
      });
    } catch (caught) {
      // Rollback: devolve exatamente o estado anterior.
      setColumns(snapshot);
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível mover o card',
      );
    }
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        <div className="flex gap-3 overflow-x-auto pb-3">
          {board.columns.map((column) => (
            <Column
              key={column.slug}
              slug={column.slug}
              name={column.name}
              color={column.color}
              cards={columns[column.slug] ?? []}
            />
          ))}
        </div>

        <DragOverlay>
          {dragging ? <Card card={dragging} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function Column({
  slug,
  name,
  color,
  cards,
}: {
  slug: string;
  name: string;
  color: string;
  cards: PipelineCardView[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: slug });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-card border bg-surface-soft/60 transition-colors',
        isOver ? 'border-brand-600 bg-brand-50' : 'border-line',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-navy-900">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          {name}
        </span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
          {cards.length}
        </span>
      </header>

      <div className="flex-1 space-y-2 px-2 pb-2">
        {cards.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted">Sem leads</p>
        ) : (
          cards.map((card) => <Card key={card.id} card={card} />)
        )}
      </div>
    </section>
  );
}

function Card({ card, overlay = false }: { card: PipelineCardView; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={cn(
        'cursor-grab rounded-control border border-line bg-surface p-3 shadow-sm active:cursor-grabbing',
        isDragging && !overlay && 'opacity-40',
        overlay && 'shadow-card-hover',
      )}
    >
      <Link
        href={`/leads/${card.leadId}`}
        className="block truncate text-[13px] font-semibold text-navy-900 hover:text-brand-600"
        // Evita que o clique no link inicie um arrasto.
        onPointerDown={(event) => event.stopPropagation()}
      >
        {card.name}
      </Link>

      <p className="mt-0.5 truncate text-[11px] text-muted">
        {card.category ?? 'Sem categoria'}
        {card.city ? ` · ${card.city}` : ''}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ScoreBadge value={card.score} level={card.scoreLevel} />
        <WebsiteBadge status={card.websiteStatus} />
      </div>
    </article>
  );
}
