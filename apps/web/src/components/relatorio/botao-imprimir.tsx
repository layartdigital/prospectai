'use client';

import { Printer } from 'lucide-react';

/**
 * O único pedaço interativo do relatório.
 *
 * `window.print()` abre a caixa de impressão do navegador, que é também de onde
 * sai o PDF — "Salvar como PDF" é um destino de impressora em todos os
 * navegadores atuais. Por isso não há um segundo botão de "baixar PDF": ele
 * exigiria gerar o arquivo no servidor, e entregaria o mesmo documento que este
 * botão já entrega, com um renderizador a mais para manter.
 *
 * Ele próprio carrega `pa-nao-imprime`: um botão "Imprimir" impresso no
 * documento é a marca de página web salva como se fosse arquivo.
 */
export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="pa-nao-imprime inline-flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-navy-900 transition-colors hover:bg-surface-soft"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" />
      Imprimir ou salvar em PDF
    </button>
  );
}
