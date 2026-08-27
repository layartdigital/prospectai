import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

/**
 * Le o corpo de uma resposta com teto nos dois lados da descompressao.
 *
 * `SECURITY-EGRESS-POLICY-v3.md` §2.4. A v1 tinha um limite so, e ele contava
 * bytes na rede — o que deixa passar 2 MB de gzip que inflam para 40 GB. O
 * teste S6 dela passava verde enquanto o worker morria por memoria.
 *
 * **Os dois tetos existem porque medem coisas diferentes:** o comprimido
 * protege a banda e o tempo; o descomprimido protege a memoria. Um nao
 * substitui o outro, e a v1 achava que sim.
 *
 * Corta no fluxo, nunca depois. Acumular para so entao medir e o mesmo que
 * nao ter limite: quando a conta fecha, a memoria ja foi.
 */

export const TETO_COMPRIMIDO = 5 * 1024 * 1024;
export const TETO_DESCOMPRIMIDO = 10 * 1024 * 1024;

export type MotivoCorte =
  | 'COMPRIMIDO_GRANDE'
  | 'DESCOMPRIMIDO_GRANDE'
  | 'ENCODING_ANINHADO'
  | 'ENCODING_DESCONHECIDO'
  /**
   * A fonte morreu no meio — reset, prazo estourado, servidor que desligou.
   *
   * Nao existia enquanto o transporte era um dublê, porque gerador de teste nao
   * quebra. Com socket de verdade e rotina, e a ausencia deste caso tinha duas
   * consequencias: no ramo sem compressao o `lerCorpo` **lancava** em vez de
   * devolver — furando a promessa de que `buscar()` nunca rejeita — e no ramo
   * com compressao a falha de rede saia rotulada `DESCOMPRIMIDO_GRANDE`, ou
   * seja, um problema de rede virava evento de seguranca no log.
   */
  | 'LEITURA_INTERROMPIDA';

export type LeituraCorpo =
  | { ok: true; bytes: Buffer; bytesNaRede: number }
  | { ok: false; motivo: MotivoCorte; bytesNaRede: number };

/**
 * Escolhe o descompressor.
 *
 * `Content-Encoding` aninhado (`gzip, br`) e recusado: cada camada multiplica
 * o fator de expansao, e nao ha site legitimo que precise de duas. Recusar e
 * mais barato que raciocinar sobre o produto dos fatores.
 */
function descompressor(encoding: string | undefined) {
  const valor = (encoding ?? '').trim().toLowerCase();
  if (valor === '' || valor === 'identity') return { tipo: 'nenhum' as const };
  if (valor.includes(',')) return { tipo: 'recusar' as const, motivo: 'ENCODING_ANINHADO' as const };
  if (valor === 'gzip' || valor === 'x-gzip') return { tipo: 'stream' as const, criar: createGunzip };
  if (valor === 'deflate') return { tipo: 'stream' as const, criar: createInflate };
  if (valor === 'br') return { tipo: 'stream' as const, criar: createBrotliDecompress };
  return { tipo: 'recusar' as const, motivo: 'ENCODING_DESCONHECIDO' as const };
}

export async function lerCorpo(
  pedacos: AsyncIterable<Uint8Array>,
  contentEncoding?: string,
): Promise<LeituraCorpo> {
  const escolha = descompressor(contentEncoding);
  if (escolha.tipo === 'recusar') {
    return { ok: false, motivo: escolha.motivo, bytesNaRede: 0 };
  }

  let naRede = 0;

  if (escolha.tipo === 'nenhum') {
    const partes: Buffer[] = [];
    try {
      for await (const p of pedacos) {
        naRede += p.byteLength;
        if (naRede > TETO_COMPRIMIDO) {
          return { ok: false, motivo: 'COMPRIMIDO_GRANDE', bytesNaRede: naRede };
        }
        partes.push(Buffer.from(p));
      }
    } catch {
      return { ok: false, motivo: 'LEITURA_INTERROMPIDA', bytesNaRede: naRede };
    }
    return { ok: true, bytes: Buffer.concat(partes), bytesNaRede: naRede };
  }

  // Com descompressao, os dois contadores correm ao mesmo tempo. O `zlib`
  // emite conforme consome, entao o corte do lado inflado acontece antes de a
  // bomba inteira ser lida — e e por isso que o teto tem efeito.
  const fluxo = escolha.criar();
  const saida: Buffer[] = [];
  let inflado = 0;
  let cortou: MotivoCorte | null = null;
  let fonteFalhou = false;

  const fim = new Promise<void>((resolve, reject) => {
    fluxo.on('data', (p: Buffer) => {
      inflado += p.byteLength;
      if (inflado > TETO_DESCOMPRIMIDO) {
        cortou ??= 'DESCOMPRIMIDO_GRANDE';
        fluxo.destroy();
        return;
      }
      saida.push(p);
    });
    fluxo.on('end', () => resolve());
    fluxo.on('close', () => resolve());
    fluxo.on('error', (e: NodeJS.ErrnoException) => {
      // Destruimos o fluxo de proposito ao cortar — e tambem quando a fonte
      // morre. Nos dois casos o erro que vem disso nao e falha do payload, e a
      // consequencia do nosso proprio `destroy()`. Qualquer outro e malformado.
      if (cortou !== null || fonteFalhou) resolve();
      else reject(e);
    });
  });

  try {
    // O `try` interno separa "a fonte morreu" de "o zlib reclamou". Sem essa
    // separacao um reset de socket sairia como `DESCOMPRIMIDO_GRANDE` — e um
    // problema de rede viraria evento de seguranca no log.
    try {
      for await (const p of pedacos) {
        if (cortou !== null) break;
        naRede += p.byteLength;
        if (naRede > TETO_COMPRIMIDO) {
          cortou = 'COMPRIMIDO_GRANDE';
          fluxo.destroy();
          break;
        }
        if (!fluxo.write(Buffer.from(p))) {
          // Esperar SO por `drain` trava para sempre quando o fluxo ja foi
          // destruido pelo corte: stream destruido nao emite `drain`.
          //
          // Custou um hang de verdade. Com bomba de 64 MB o teste passava — o
          // corte caia entre escritas, sem `drain` pendente. Com 256 MB o
          // processo parou e nao voltou. **Hang e pior que o DoS que o limite
          // existe para impedir:** a vaga do worker fica presa sem erro, sem
          // log e sem timeout.
          await new Promise<void>((r) => {
            const solta = (): void => {
              fluxo.off('drain', solta);
              fluxo.off('close', solta);
              fluxo.off('error', solta);
              r();
            };
            fluxo.once('drain', solta);
            fluxo.once('close', solta);
            fluxo.once('error', solta);
          });
        }
      }
    } catch {
      fonteFalhou = true;
      fluxo.destroy();
    }
    if (cortou === null && !fonteFalhou) fluxo.end();
    await fim;
  } catch {
    return { ok: false, motivo: 'DESCOMPRIMIDO_GRANDE', bytesNaRede: naRede };
  }

  if (fonteFalhou) return { ok: false, motivo: 'LEITURA_INTERROMPIDA', bytesNaRede: naRede };
  if (cortou !== null) return { ok: false, motivo: cortou, bytesNaRede: naRede };
  return { ok: true, bytes: Buffer.concat(saida), bytesNaRede: naRede };
}
