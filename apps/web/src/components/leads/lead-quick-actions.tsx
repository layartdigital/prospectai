'use client';

import { Check, Copy, ExternalLink, MessageCircle, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { clientApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface Props {
  leadId: string;
  phone: string | null;
  phoneIsMasked: boolean;
  whatsappUrl: string | null;
  mapsUrl: string | null;
  isFavorite: boolean;
}

const buttonClass =
  'inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-navy-900 transition-colors hover:border-brand-600 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50';

export function LeadQuickActions({
  leadId,
  phone,
  phoneIsMasked,
  whatsappUrl,
  mapsUrl,
  isFavorite,
}: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [favorite, setFavorite] = useState(isFavorite);
  const [busy, setBusy] = useState<string | null>(null);

  /** Toda interação vira LeadActivity — é a trilha do que foi feito. */
  function track(type: string): void {
    void clientApi(`/leads/${leadId}/activities`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }).catch(() => {
      // Falha de trilha não pode impedir a ação do usuário.
    });
  }

  async function copyPhone(): Promise<void> {
    if (!phone || phoneIsMasked) return;

    await navigator.clipboard.writeText(phone);
    setCopied(true);
    track('PHONE_COPIED');
    setTimeout(() => setCopied(false), 2000);
  }

  async function toggleFavorite(): Promise<void> {
    if (busy) return;
    setBusy('favorite');

    const next = !favorite;
    setFavorite(next);

    try {
      await clientApi(`/leads/${leadId}/favorite`, {
        method: next ? 'POST' : 'DELETE',
      });
      router.refresh();
    } catch {
      setFavorite(!next);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => void copyPhone()}
        disabled={!phone || phoneIsMasked}
        title={
          phoneIsMasked
            ? 'Telefone parcialmente oculto no plano gratuito'
            : 'Copiar telefone'
        }
        className={buttonClass}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {copied ? 'Copiado' : 'Copiar telefone'}
      </button>

      {/* Só renderiza quando existe número compatível. Um botão que abre
          link quebrado é pior do que botão ausente. */}
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('WHATSAPP_OPENED')}
          className={buttonClass}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Abrir WhatsApp
        </a>
      ) : (
        <span className="pa-signal-unknown px-3 py-1.5">
          WhatsApp não verificado
        </span>
      )}

      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track('MAP_OPENED')}
          className={buttonClass}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Abrir no Google Maps
        </a>
      ) : null}

      <button
        type="button"
        onClick={() => void toggleFavorite()}
        disabled={busy !== null}
        className={cn(buttonClass, favorite && 'border-warning text-warning')}
      >
        <Star
          className={cn('h-3.5 w-3.5', favorite && 'fill-warning')}
          aria-hidden="true"
        />
        {favorite ? 'Favorito' : 'Favoritar'}
      </button>

      {/*
        O botão de recalcular saiu daqui em 31/07/2026.
        O escopo §3.2 o coloca no LeadScoreCard, junto do número e dos motivos
        que ele altera — recalcular no meio de "copiar telefone" e "abrir mapa"
        separa a ação do efeito. Vive agora em recalculate-score-button.tsx.
      */}
    </div>
  );
}
