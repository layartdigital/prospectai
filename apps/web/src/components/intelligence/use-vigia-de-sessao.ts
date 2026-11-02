'use client';

import { chaveDeIdentidade, compararIdentidade, type SessionResponse } from '@propectai/types';
import { useCallback, useEffect, useRef } from 'react';

import { ClientApiError, clientApi } from '@/lib/client-api';
import { ouvirMudancaDeSessao } from '@/lib/session-events';

/** Intervalo da checagem periódica enquanto a aba está visível. */
export const INTERVALO_VIGIA_MS = 20_000;

export type MotivoDeMudanca = 'IDENTIDADE_DIFERENTE' | 'SESSAO_ENCERRADA';

/**
 * Vigia de sessão (P04-QA-02, item 4).
 *
 * Compara a identidade com que a tela foi montada (`identidade`, entregue pelo
 * servidor) com a que `GET /auth/me` devolve agora. Se mudou — outro usuário ou outro
 * workspace nos cookies do navegador, ou sessão encerrada em outra aba — chama
 * `aoMudar` UMA vez. Quem chama descarta o estado e pede `router.refresh()`.
 *
 * Por que não basta a API recusar: a recusa (prova de profundidade, RLS) protege o
 * dado no servidor, mas o grafo do workspace anterior continuaria desenhado na tela.
 *
 * Gatilho IMEDIATO para mudança de contexto que a própria aplicação conhece (P04-QA-03): login,
 * logout ou troca anunciados por outra aba (`lib/session-events`). `logout` descarta na hora, sem
 * esperar rede; `login`/`troca` consultam `/auth/me` já. A checagem periódica de 20 s é só a rede de
 * segurança para mudanças que a aplicação não viu (cookie trocado por fora, sessão expirada).
 *
 * Gatilhos de reserva: foco da janela, aba voltando a ficar visível, restauração do bfcache
 * (`pageshow`), volta da rede, intervalo enquanto visível, e `verificarAgora()`, que a
 * tela chama quando uma de suas requisições volta 401/403.
 *
 * Falha de rede NÃO é mudança: sem resposta não há motivo para apagar o trabalho de
 * ninguém. 401 também não decide sozinho (o access token dura 15 min e o refresh pode
 * estar válido): quem renova e decide é o servidor, via `onSessaoIncerta` →
 * `router.refresh()`.
 */
export function useVigiaDeSessao(opcoes: {
  identidade: string;
  aoMudar: (motivo: MotivoDeMudanca) => void;
  aoIncerta: () => void;
}): { verificarAgora: () => Promise<void> } {
  const { identidade } = opcoes;
  const aoMudar = useRef(opcoes.aoMudar);
  const aoIncerta = useRef(opcoes.aoIncerta);
  aoMudar.current = opcoes.aoMudar;
  aoIncerta.current = opcoes.aoIncerta;

  const disparou = useRef(false);
  const verificando = useRef(false);
  const vivo = useRef(true);

  const verificarAgora = useCallback(async (): Promise<void> => {
    if (disparou.current || verificando.current) return;
    verificando.current = true;
    try {
      const sessao = await clientApi<SessionResponse>('/auth/me');
      if (!vivo.current || disparou.current) return;
      if (compararIdentidade(identidade, chaveDeIdentidade(sessao)) === 'MUDOU') {
        disparou.current = true;
        aoMudar.current('IDENTIDADE_DIFERENTE');
      }
    } catch (e) {
      if (!vivo.current || disparou.current) return;
      if (e instanceof ClientApiError && e.statusCode === 401) aoIncerta.current();
      // qualquer outro erro (rede, 5xx): sem prova de mudança, nada é descartado.
    } finally {
      verificando.current = false;
    }
  }, [identidade]);

  useEffect(() => {
    vivo.current = true;
    const aoVoltar = (): void => {
      if (document.visibilityState === 'visible') void verificarAgora();
    };
    const timer = window.setInterval(aoVoltar, INTERVALO_VIGIA_MS);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('pageshow', aoVoltar);
    window.addEventListener('online', aoVoltar);
    document.addEventListener('visibilitychange', aoVoltar);
    const parar = ouvirMudancaDeSessao((motivo) => {
      if (disparou.current) return;
      if (motivo === 'logout') {
        disparou.current = true;
        aoMudar.current('SESSAO_ENCERRADA');
      } else {
        void verificarAgora();
      }
    });
    return () => {
      parar();
      vivo.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('pageshow', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [verificarAgora]);

  return { verificarAgora };
}
