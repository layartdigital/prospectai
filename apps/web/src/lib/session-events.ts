'use client';

/**
 * Aviso de mudança de sessão entre abas do mesmo navegador (P04-QA-03).
 *
 * Os cookies de sessão são compartilhados por todas as abas. Quando o usuário sai,
 * entra ou troca de conta numa aba, as OUTRAS abas continuam mostrando dados da conta
 * anterior até alguma checagem perceber. Este canal elimina a espera: quem muda a sessão
 * a anuncia, e telas com dados sensíveis (o Intelligence Explorer) reagem na hora —
 * em vez de depender da checagem periódica de `/auth/me`.
 *
 * O aviso é só um GATILHO: nunca carrega identidade, dado ou credencial. Quem decide o
 * que é verdade continua sendo o servidor (`/auth/me`), exceto no caso `logout`, em que
 * a tela descarta o estado de imediato (descartar nunca expõe nada).
 *
 * Mesma origem e mesmo navegador apenas (BroadcastChannel); `storage` como reserva.
 */

export type MotivoDeSessao = 'login' | 'logout' | 'troca';

const CANAL = 'propectai-sessao';
const MOTIVOS: readonly string[] = ['login', 'logout', 'troca'];

function motivoValido(valor: unknown): MotivoDeSessao | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const tipo = (valor as { tipo?: unknown }).tipo;
  return typeof tipo === 'string' && MOTIVOS.includes(tipo) ? (tipo as MotivoDeSessao) : null;
}

/** Anuncia às outras abas que a sessão deste navegador mudou. Nunca lança. */
export function anunciarMudancaDeSessao(motivo: MotivoDeSessao): void {
  const msg = { tipo: motivo, em: Date.now() };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const canal = new BroadcastChannel(CANAL);
      canal.postMessage(msg);
      canal.close();
      return;
    }
  } catch {
    // cai na reserva
  }
  try {
    window.localStorage.setItem(CANAL, JSON.stringify(msg));
  } catch {
    // sem canal algum: a checagem periódica do vigia continua valendo
  }
}

/** Escuta anúncios de outras abas. Devolve a função que cancela a escuta. */
export function ouvirMudancaDeSessao(aoOuvir: (motivo: MotivoDeSessao) => void): () => void {
  let canal: BroadcastChannel | null = null;
  const aoStorage = (e: StorageEvent): void => {
    if (e.key !== CANAL || !e.newValue) return;
    try {
      const m = motivoValido(JSON.parse(e.newValue));
      if (m) aoOuvir(m);
    } catch {
      // mensagem malformada: ignorada
    }
  };
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      canal = new BroadcastChannel(CANAL);
      canal.onmessage = (e: MessageEvent): void => {
        const m = motivoValido(e.data);
        if (m) aoOuvir(m);
      };
    } else {
      window.addEventListener('storage', aoStorage);
    }
  } catch {
    window.addEventListener('storage', aoStorage);
  }
  return () => {
    canal?.close();
    window.removeEventListener('storage', aoStorage);
  };
}
