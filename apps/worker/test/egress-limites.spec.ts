import { brotliCompressSync, createGzip, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  lerCorpo,
  TETO_COMPRIMIDO,
  TETO_DESCOMPRIMIDO,
} from '../src/egress/limites';

/**
 * Limites de resposta — `SECURITY-EGRESS-POLICY-v3.md` §2.4.
 *
 * As bombas aqui sao geradas de verdade com `gzipSync`, nao simuladas. Um teste
 * que finge a bomba prova que o `if` esta escrito; um que a constroi prova que
 * o corte acontece antes de a memoria acabar — e a diferenca entre os dois ja
 * custou um hang neste arquivo.
 */

async function* pedacos(b: Buffer, tam = 16 * 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < b.length; i += tam) yield b.subarray(i, i + tam);
}

const html = Buffer.from(`<html>${'a'.repeat(50_000)}</html>`);

describe('sem compressao', () => {
  it('deixa passar corpo pequeno', async () => {
    const r = await lerCorpo(pedacos(Buffer.from('<html>oi</html>')));
    expect(r.ok && r.bytes.toString()).toBe('<html>oi</html>');
  });

  it('aceita exatamente o teto', async () => {
    const r = await lerCorpo(pedacos(Buffer.alloc(TETO_COMPRIMIDO, 0x41)));
    expect(r.ok).toBe(true);
  });

  it('S6 corta um byte acima do teto', async () => {
    const r = await lerCorpo(pedacos(Buffer.alloc(TETO_COMPRIMIDO + 1, 0x41)));
    expect(r.ok ? 'passou' : r.motivo).toBe('COMPRIMIDO_GRANDE');
  });
});

describe('compressao legitima', () => {
  it('gzip', async () => {
    const r = await lerCorpo(pedacos(gzipSync(html)), 'gzip');
    expect(r.ok && r.bytes.byteLength).toBe(html.byteLength);
  });

  it('brotli', async () => {
    const r = await lerCorpo(pedacos(brotliCompressSync(html)), 'br');
    expect(r.ok && r.bytes.byteLength).toBe(html.byteLength);
  });

  it('encoding em maiuscula', async () => {
    const r = await lerCorpo(pedacos(gzipSync(html)), 'GZIP');
    expect(r.ok).toBe(true);
  });

  it('identity nao descomprime', async () => {
    const r = await lerCorpo(pedacos(html), 'identity');
    expect(r.ok && r.bytes.byteLength).toBe(html.byteLength);
  });
});

/**
 * Monta a bomba SEM materializar o payload.
 *
 * A primeira versao fazia `gzipSync(Buffer.alloc(256 * 1024 * 1024))` — e um
 * teste cuja tese e "nao estouramos a memoria" precisava de 256 MB contiguos
 * para rodar. Em maquina sob carga isso falha com `Array buffer allocation
 * failed`, **no preparo, antes de exercitar coisa nenhuma**, e o vermelho nao
 * diz nada sobre o codigo.
 *
 * Escrevendo em blocos de 1 MB no fluxo de compressao, o pico fica em ~1 MB e a
 * bomba sai identica: o comprimido e o mesmo, e e ele que vai para o `lerCorpo`.
 */
async function bombaDeGzip(mb: number): Promise<Buffer> {
  const gz = createGzip();
  const partes: Buffer[] = [];
  gz.on('data', (p: Buffer) => partes.push(p));

  const fim = new Promise<void>((resolve, reject) => {
    gz.on('end', () => resolve());
    gz.on('error', reject);
  });

  // Reutilizado a cada volta: e so zero, nunca e mutado, e nao alocar 1 MB por
  // iteracao e metade do ponto.
  const bloco = Buffer.alloc(1024 * 1024, 0);
  for (let i = 0; i < mb; i++) {
    if (!gz.write(bloco)) {
      await new Promise<void>((r) => gz.once('drain', () => r()));
    }
  }
  gz.end();
  await fim;

  return Buffer.concat(partes);
}

describe('S6b — bomba de gzip', () => {
  it('corta a bomba e nao devolve o conteudo', async () => {
    const bomba = await bombaDeGzip(64);
    expect(bomba.byteLength).toBeLessThan(TETO_COMPRIMIDO); // passa no teto da rede
    const r = await lerCorpo(pedacos(bomba), 'gzip');
    expect(r.ok ? 'passou' : r.motivo).toBe('DESCOMPRIMIDO_GRANDE');
  });

  it('para de ler a rede ao cortar', async () => {
    const bomba = await bombaDeGzip(128);
    const r = await lerCorpo(pedacos(bomba), 'gzip');
    // Nao consome a bomba inteira: corta assim que o inflado passa do teto.
    expect(!r.ok && r.bytesNaRede).toBeLessThan(bomba.byteLength);
  });

  /**
   * Regressao de um hang real.
   *
   * A primeira versao esperava so por `drain` quando a escrita sofria
   * contrapressao. Fluxo destruido pelo corte nunca emite `drain`, e o processo
   * parava para sempre — sem erro, sem log, com a vaga do worker presa.
   *
   * Com 64 MB passava: o corte caia entre escritas. So apareceu com 256 MB, e
   * so porque a memoria foi medida em vez de suposta.
   */
  it('nao trava com bomba grande, em varios tamanhos', async () => {
    for (const mb of [64, 128, 256]) {
      const bomba = await bombaDeGzip(mb);
      const r = await Promise.race([
        lerCorpo(pedacos(bomba), 'gzip'),
        new Promise<'TRAVOU'>((res) => setTimeout(() => res('TRAVOU'), 15_000)),
      ]);
      expect(r === 'TRAVOU' ? 'TRAVOU' : r.ok ? 'passou' : r.motivo).toBe(
        'DESCOMPRIMIDO_GRANDE',
      );
    }
  }, 60_000);

  it('mantem o heap muito abaixo do tamanho inflado', async () => {
    const bomba = await bombaDeGzip(256);
    const antes = process.memoryUsage().heapUsed;
    await lerCorpo(pedacos(bomba), 'gzip');
    const delta = process.memoryUsage().heapUsed - antes;
    // 256 MB inflados, teto de 10 MB. Folga generosa para nao ficar instavel
    // em maquina sob carga, e ainda assim ordens de grandeza abaixo da bomba.
    expect(delta).toBeLessThan(64 * 1024 * 1024);
  }, 30_000);
});

describe('encoding recusado', () => {
  it('aninhado', async () => {
    const r = await lerCorpo(pedacos(gzipSync(html)), 'gzip, br');
    expect(r.ok ? 'passou' : r.motivo).toBe('ENCODING_ANINHADO');
  });

  it('desconhecido', async () => {
    const r = await lerCorpo(pedacos(html), 'exotico');
    expect(r.ok ? 'passou' : r.motivo).toBe('ENCODING_DESCONHECIDO');
  });

  it('gzip malformado nao derruba o processo', async () => {
    const r = await lerCorpo(pedacos(Buffer.from('nao e gzip nenhum')), 'gzip');
    expect(r.ok).toBe(false);
  });
});

describe('constantes', () => {
  it('os dois tetos medem coisas diferentes', () => {
    expect(TETO_COMPRIMIDO).toBe(5 * 1024 * 1024);
    expect(TETO_DESCOMPRIMIDO).toBe(10 * 1024 * 1024);
  });
});
