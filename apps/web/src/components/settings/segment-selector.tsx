'use client';

import type {
  SegmentDetail,
  SegmentOption,
  SegmentSearchResult,
  SegmentSummary,
} from '@propectai/types';
import { Check, Loader2, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { clientApi } from '@/lib/client-api';

/**
 * Escolha do segmento de atuação.
 *
 * Busca com no máximo 40 resultados e navegação por macro-segmento, porque são
 * 500 em 50 categorias — lista suspensa com tudo é lista que ninguém percorre.
 *
 * Aplicar os padrões é uma segunda decisão, separada da escolha do segmento.
 * Trocar de segmento não pode reescrever em silêncio a lista de nichos que a
 * pessoa ajustou à mão, e por isso o padrão **soma** ao que existe.
 */
export function SegmentSelector({ atual }: { atual: SegmentSummary | null }) {
  const router = useRouter();

  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [macro, setMacro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<SegmentSearchResult | null>(null);
  const [selecionado, setSelecionado] = useState<SegmentDetail | null>(null);
  const [aplicarPadroes, setAplicarPadroes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;

    // Espera curta antes de buscar: digitar "consultoria" dispararia onze
    // requisições, e o servidor responderia dez respostas descartadas.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (termo) params.set('q', termo);
      if (macro) params.set('macroSegment', macro);

      void clientApi<SegmentSearchResult>(`/segments?${params.toString()}`)
        .then(setResultado)
        .catch(() => setErro('Não foi possível buscar segmentos.'));
    }, 300);

    return () => clearTimeout(timer);
  }, [aberto, termo, macro]);

  async function escolher(opcao: SegmentOption): Promise<void> {
    setBusy(true);
    setErro(null);

    try {
      const detalhe = await clientApi<SegmentDetail>(`/segments/${opcao.id}`);
      setSelecionado(detalhe);
    } catch {
      setErro('Não foi possível carregar o segmento.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (!selecionado || busy) return;
    setBusy(true);
    setErro(null);

    try {
      await clientApi('/settings/segment', {
        method: 'PATCH',
        body: JSON.stringify({ segmentId: selecionado.id, applyDefaults: aplicarPadroes }),
      });
      setAberto(false);
      setSelecionado(null);
      router.refresh();
    } catch (caught) {
      setErro(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pa-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-card-title text-navy-900">Seu segmento</h2>
          {atual ? (
            <>
              <p className="mt-1 text-[13px] font-medium text-navy-900">{atual.name}</p>
              <p className="text-xs text-muted">{atual.macroSegment}</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Escolher o segmento preenche serviços e nichos com o que costuma
              funcionar para quem atua nele. Tudo continua editável.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAberto((valor) => !valor)}
          className="rounded-control border border-line px-3 py-1.5 text-xs font-medium text-navy-900 hover:border-brand-600"
        >
          {atual ? 'Trocar' : 'Escolher segmento'}
        </button>
      </div>

      {aberto ? (
        <div className="mt-4 border-t border-line pt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={termo}
              onChange={(event) => setTermo(event.target.value)}
              placeholder="Buscar: contabilidade, software, logística…"
              className="w-full rounded-control border border-line bg-surface py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-muted"
            />
          </div>

          {resultado ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setMacro(null)}
                  className={`rounded-control border px-2.5 py-1 text-[11px] ${
                    macro === null
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line text-muted hover:border-brand-600'
                  }`}
                >
                  Todos
                </button>
                {resultado.macroSegments.slice(0, 12).map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => setMacro(item.name)}
                    className={`rounded-control border px-2.5 py-1 text-[11px] ${
                      macro === item.name
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-line text-muted hover:border-brand-600'
                    }`}
                  >
                    {item.name} · {item.count}
                  </button>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-muted">
                {resultado.total} {resultado.total === 1 ? 'segmento' : 'segmentos'}
                {resultado.total > resultado.items.length
                  ? ` · mostrando ${resultado.items.length}, refine a busca`
                  : ''}
              </p>

              <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-control border border-line">
                {resultado.items.map((opcao) => (
                  <li key={opcao.id}>
                    <button
                      type="button"
                      onClick={() => void escolher(opcao)}
                      className={`w-full px-3 py-2 text-left transition-colors hover:bg-surface-soft ${
                        selecionado?.id === opcao.id ? 'bg-brand-600/5' : ''
                      }`}
                    >
                      <span className="block text-[13px] text-navy-900">{opcao.name}</span>
                      <span className="block text-[11px] text-muted">
                        {opcao.macroSegment}
                        {opcao.specialty ? ` · ${opcao.specialty}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted">Carregando…</p>
          )}

          {/* ---- Confirmação, com o que vai ser aplicado à vista ----------
              Mostrar antes de aplicar evita a surpresa de ver quinze nichos
              novos aparecerem sem explicação. */}
          {selecionado ? (
            <div className="mt-4 rounded-card border border-brand-600/30 bg-brand-600/5 p-3">
              <p className="text-[13px] font-semibold text-navy-900">
                {selecionado.name}
              </p>

              {selecionado.services.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted">
                  <strong className="text-navy-900">Serviços:</strong>{' '}
                  {selecionado.services.join(' · ')}
                </p>
              ) : null}

              {selecionado.targetSectors.length > 0 ? (
                <p className="mt-1 text-[11px] text-muted">
                  <strong className="text-navy-900">Setores-alvo:</strong>{' '}
                  {selecionado.targetSectors.join(' · ')}
                </p>
              ) : null}

              {/* A procedência do termo é dita, não escondida.
                  Termo gerado por modelo pode ser plausível e inútil: uma
                  expressão que ninguém usa devolve busca vazia, e sem o aviso
                  a conclusão seria "o produto não funciona no meu país". */}
              {selecionado.searchTerms.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted">
                  <strong className="text-navy-900">Termos de busca:</strong>{' '}
                  {selecionado.searchTerms.join(' · ')}
                  {selecionado.searchTermsStatus === 'GERADO' ? (
                    <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      sugerido, não verificado
                    </span>
                  ) : null}
                  {selecionado.searchTermsStatus === 'CURADO' ? (
                    <span className="ml-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                      revisado
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-warning">
                  Sem termos de busca no seu idioma ainda. A busca continua
                  funcionando com o termo que você digitar.
                </p>
              )}

              <label className="mt-3 flex items-center gap-2 text-xs text-navy-900">
                <input
                  type="checkbox"
                  checked={aplicarPadroes}
                  onChange={(event) => setAplicarPadroes(event.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Somar esses serviços e setores aos meus
              </label>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void confirmar()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => setSelecionado(null)}
                  className="flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs text-muted hover:text-navy-900"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          {erro ? (
            <p role="alert" className="mt-3 text-xs text-danger">
              {erro}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
