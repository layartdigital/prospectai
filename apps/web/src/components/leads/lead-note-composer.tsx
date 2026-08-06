'use client';

import type { LeadNoteView } from '@propectai/types';
import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { formatDateTime } from '@/lib/utils';

export function LeadNoteComposer({
  leadId,
  notes,
}: {
  leadId: string;
  notes: LeadNoteView[];
}) {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content.trim().length > 0;

  async function save(): Promise<void> {
    if (saving || !dirty) return;

    setSaving(true);
    setError(null);

    try {
      await clientApi(`/leads/${leadId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: content.trim() }),
      });
      setContent('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível salvar',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <label htmlFor="lead-note" className="pa-label mb-1.5 block">
        Observações
      </label>

      <textarea
        id="lead-note"
        rows={3}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Anotações livres sobre este lead…"
        className="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 text-xs text-navy-900 placeholder:text-muted"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Indicação visual de alteração não salva. */}
        <span className="text-[11px] text-muted">
          {dirty ? 'Alterações não salvas' : `${notes.length} observação(ões)`}
        </span>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-control bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Salvar
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {notes.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-line pt-3">
          {notes.slice(0, 4).map((note) => (
            <li key={note.id} className="text-xs">
              <p className="text-navy-900">{note.content}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {note.authorName ?? 'Sistema'} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
