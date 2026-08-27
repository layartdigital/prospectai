import { createHash } from 'node:crypto';

import { validarUrl, type MotivoRecusa, type Resolvedor } from './guard';
import { lerCorpo, type MotivoCorte } from './limites';

/**
 * Busca uma URL de terceiro sob a egress policy inteira.
 *
 * `SECURITY-EGRESS-POLICY-v3.md` §2.3 e §2.4. Junta as tres pecas: o `guard`
 * decide o destino, o `limites` le o corpo com teto, e aqui ficam o redirect,
 * o orcamento de tempo e o hash.
 *
 * **O transporte e injetado, e nao por gosto de teste.** E o ponto onde o
 * `fetcher` isolado da §2.5 entra quando existir: hoje o transporte abre o
 * socket no proprio worker (`FETCHER_MODE=inline`, ADR-004 Parte 1), amanha
 * ele fala com outro processo. Nada acima desta funcao muda quando isso
 * acontecer.
 */

export const TIMEOUT_REQUISICAO_MS = 10_000;
export const ORCAMENTO_JOB_MS = 30_000;

/**
 * Teto de redirects. Era 3, e o primeiro site brasileiro grande que medimos
 * encostou nele exatamente.
 *
 * `gov.br` gasta **tres saltos** — `http://gov.br` → https → `www.gov.br` →
 * `/pt-br` — e le o corpo na quarta requisicao. Um redirect a mais, como uma
 * normalizacao de barra final depois do locale, sairia como `REDIRECT_DEMAIS`,
 * e o relatorio diria ao cliente que o site dele esta inalcancavel. **Falso
 * negativo entregue como achado.**
 *
 * O 3 foi escolhido no abstrato, na v1 da politica; a cadeia
 * `apex → https → www → locale` nao e exotica, e o padrao de qualquer site com
 * internacionalizacao.
 *
 * **Subir nao afrouxa a seguranca**, e vale registrar por que: cada salto
 * continua revalidado pelo `guard` contra a tabela de faixas — o S4, de publico
 * para loopback, e barrado no salto onde acontecer, seja o segundo ou o quinto.
 * O que cresce e o tempo, e o tempo ja tem teto proprio no `ORCAMENTO_JOB_MS`.
 */
export const MAX_SALTOS = 5;

export type MotivoFalha =
  | MotivoRecusa
  | MotivoCorte
  | 'REDIRECT_DEMAIS'
  | 'REDIRECT_SEM_DESTINO'
  | 'ORCAMENTO_ESGOTADO'
  | 'TRANSPORTE_FALHOU';

export interface Destino {
  /** Conectar aqui. */
  readonly ip: string;
  readonly familia: 4 | 6;
  /** Vai em `Host` e SNI — nunca e resolvido de novo. */
  readonly hostname: string;
  readonly porta: number;
  readonly https: boolean;
  readonly caminho: string;
  readonly timeoutMs: number;
}

export interface RespostaBruta {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly corpo: AsyncIterable<Uint8Array>;
  /**
   * Solta o socket quando o corpo nao vai ser lido.
   *
   * Opcional porque o dublê dos testes nao tem socket para soltar — e foi
   * exatamente por isso que a falta passou despercebida ate o transporte real
   * existir: redirect e corte por tamanho saem sem consumir o corpo, e com
   * `agent: false` cada saida dessas deixava uma conexao aberta ate o prazo.
   */
  readonly descartar?: () => void;
}

export type Transporte = (destino: Destino) => Promise<RespostaBruta>;

export interface Busca {
  readonly resolver: Resolvedor;
  readonly transporte: Transporte;
  /** Injetavel para testar orcamento sem esperar de verdade. */
  readonly agora?: () => number;
  readonly orcamentoMs?: number;
}

export type ResultadoBusca =
  | {
      ok: true;
      /** URL efetivamente lida, depois dos redirects. */
      urlFinal: string;
      status: number;
      headers: Readonly<Record<string, string | undefined>>;
      bytes: Buffer;
      /** sha256 do corpo decodificado e NAO sanitizado — ver nota abaixo. */
      contentHash: string;
      saltos: number;
      /** Tempo ate o primeiro byte, do primeiro salto. */
      ttfbMs: number;
    }
  | {
      ok: false;
      motivo: MotivoFalha;
      saltos: number;
      /**
       * Codigo interno da falha, quando existe. **Nunca vai para o usuario.**
       *
       * A §2.8 exige resposta uniforme a quem pediu; ela nao exige que nos
       * joguemos fora o que sabemos. Sem este campo a auditoria nao consegue
       * distinguir "certificado expirado" de "site fora do ar" — e a primeira e
       * um achado que se vende, a segunda e so uma ausencia.
       */
      detalhe?: string;
    };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * O hash e do corpo DECODIFICADO, nao dos bytes que vieram no fio.
 *
 * A politica diz "bytes crus", e a expressao e ambigua entre duas coisas.
 * Escolhido o corpo decodificado, porque o proposito do hash e **identidade de
 * conteudo**, para dedup entre tenants (§5): o mesmo HTML servido com gzip
 * hoje e sem gzip amanha e a mesma pagina, e hashear o fio faria a dedup
 * falhar por mudanca de configuracao do servidor do cliente.
 *
 * "Cru" aqui significa **antes da sanitizacao**, que e a distincao que a §3
 * realmente precisa.
 */
function hashear(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function buscar(urlInicial: string, opcoes: Busca): Promise<ResultadoBusca> {
  const agora = opcoes.agora ?? (() => Date.now());
  const orcamento = opcoes.orcamentoMs ?? ORCAMENTO_JOB_MS;
  const inicio = agora();

  let alvo = urlInicial;
  let ttfbMs = 0;

  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    const restante = orcamento - (agora() - inicio);
    if (restante <= 0) return { ok: false, motivo: 'ORCAMENTO_ESGOTADO', saltos: salto };

    // **Revalidacao completa a cada salto**, e nao so no primeiro.
    // Redirect e o caminho mais curto do publico para o interno: o primeiro
    // endereco passa, o `Location` aponta para 127.0.0.1, e sem esta linha o
    // segundo nunca seria olhado.
    const destino = await validarUrl(alvo, opcoes.resolver);
    if (!destino.permitido) return { ok: false, motivo: destino.motivo, saltos: salto };

    const t0 = agora();
    let resposta: RespostaBruta;
    try {
      resposta = await opcoes.transporte({
        ip: destino.ip,
        familia: destino.familia,
        hostname: destino.hostname,
        porta: destino.porta,
        https: destino.url.protocol === 'https:',
        caminho: destino.url.pathname + destino.url.search,
        timeoutMs: Math.min(TIMEOUT_REQUISICAO_MS, restante),
      });
    } catch (e) {
      // Erro uniforme: recusa, timeout e falha de TLS saem iguais (§2.8) — o
      // `motivo` nao distingue. O `detalhe` guarda o codigo para o log e para a
      // auditoria.
      //
      // Lido por duck typing, e nao importando `ErroTransporte`: o transporte ja
      // importa os tipos daqui, e importar de volta fecharia um ciclo. Um campo
      // `codigo` string e contrato pequeno o bastante para ser lido assim.
      const codigo = (e as { codigo?: unknown } | null)?.codigo;
      return {
        ok: false,
        motivo: 'TRANSPORTE_FALHOU',
        saltos: salto,
        detalhe: typeof codigo === 'string' ? codigo : undefined,
      };
    }

    if (salto === 0) ttfbMs = agora() - t0;

    if (REDIRECTS.has(resposta.status)) {
      // O corpo de um redirect nunca e lido. Soltar antes de qualquer saida.
      resposta.descartar?.();
      if (salto === MAX_SALTOS) {
        return { ok: false, motivo: 'REDIRECT_DEMAIS', saltos: salto + 1 };
      }
      const local = resposta.headers['location'] ?? resposta.headers['Location'];
      if (local === undefined || local.trim() === '') {
        return { ok: false, motivo: 'REDIRECT_SEM_DESTINO', saltos: salto };
      }
      // `Location` relativo e comum e legitimo. Resolver contra a URL atual —
      // e nao contra a inicial — porque a base muda a cada salto.
      try {
        alvo = new URL(local, destino.url).toString();
      } catch {
        return { ok: false, motivo: 'URL_MALFORMADA', saltos: salto };
      }
      continue;
    }

    const corpo = await lerCorpo(resposta.corpo, resposta.headers['content-encoding']);
    if (!corpo.ok) {
      // Corte por tamanho para de ler no meio: o resto do corpo continua vindo
      // pelo fio se ninguem fechar. Recusar sem soltar seria pagar a banda que
      // o teto existe para nao pagar.
      resposta.descartar?.();
      return { ok: false, motivo: corpo.motivo, saltos: salto };
    }

    return {
      ok: true,
      urlFinal: destino.url.toString(),
      status: resposta.status,
      headers: resposta.headers,
      bytes: corpo.bytes,
      contentHash: hashear(corpo.bytes),
      saltos: salto,
      ttfbMs,
    };
  }

  return { ok: false, motivo: 'REDIRECT_DEMAIS', saltos: MAX_SALTOS + 1 };
}
