import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  buscar,
  type RespostaBruta,
  type Transporte,
} from '../src/egress/fetcher';
import type { EnderecoResolvido, Resolvedor } from '../src/egress/guard';

/**
 * Orquestracao da busca — `SECURITY-EGRESS-POLICY-v3.md` §2.3 e §2.4.
 *
 * Transporte e resolvedor injetados. O que estes casos provam e a LOGICA de
 * redirect, orcamento e hash. O comportamento de socket real — TLS, timeout de
 * verdade, cadeia de certificado — fica no checklist do primeiro deploy.
 */

const resolve =
  (...ips: string[]): Resolvedor =>
  () =>
    Promise.resolve(
      ips.map((address): EnderecoResolvido => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    );

const publico = resolve('93.184.216.34');

async function* um(b: Buffer): AsyncGenerator<Uint8Array> {
  yield b;
}

const corpo = (
  texto: string,
  headers: Record<string, string> = {},
  status = 200,
): RespostaBruta => ({
  status,
  headers: { 'content-type': 'text/html', ...headers },
  corpo: um(Buffer.from(texto)),
});

describe('caminho feliz', () => {
  it('devolve o corpo e nao redireciona', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => Promise.resolve(corpo('<html>ok</html>')),
    });
    expect(r.ok && r.bytes.toString()).toBe('<html>ok</html>');
    expect(r.ok && r.saltos).toBe(0);
  });

  it('conecta ao IP validado e manda o nome em Host', async () => {
    // E o que fecha o DNS rebinding: entre validar e conectar nao ha segunda
    // resolucao que possa devolver outra coisa.
    let visto: { hostname?: string; ip?: string } = {};
    await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: (d) => {
        visto = { hostname: d.hostname, ip: d.ip };
        return Promise.resolve(corpo('ok'));
      },
    });
    expect(visto).toEqual({ ip: '93.184.216.34', hostname: 'exemplo.com.br' });
  });
});

describe('contentHash', () => {
  const html = `<html>${'x'.repeat(1000)}</html>`;

  it('e hexadecimal de 64 caracteres', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => Promise.resolve(corpo(html)),
    });
    expect(r.ok && /^[0-9a-f]{64}$/.test(r.contentHash)).toBe(true);
  });

  it('e do conteudo decodificado, nao dos bytes do fio', async () => {
    // A mesma pagina servida com e sem gzip tem o mesmo hash. Hashear o fio
    // faria a dedup entre tenants (§5) falhar quando o cliente mudasse a
    // configuracao do servidor dele — mudanca que nao altera o conteudo.
    const comGzip = await buscar('http://a.com.br/', {
      resolver: publico,
      transporte: () =>
        Promise.resolve({
          status: 200,
          headers: { 'content-encoding': 'gzip' },
          corpo: um(gzipSync(Buffer.from(html))),
        }),
    });
    const semGzip = await buscar('http://a.com.br/', {
      resolver: publico,
      transporte: () => Promise.resolve(corpo(html)),
    });
    expect(comGzip.ok && semGzip.ok && comGzip.contentHash).toBe(
      semGzip.ok ? semGzip.contentHash : '',
    );
  });
});

describe('redirect', () => {
  const emSequencia = (...respostas: RespostaBruta[]): Transporte => {
    let i = 0;
    return () => Promise.resolve(respostas[Math.min(i++, respostas.length - 1)]!);
  };

  it('S4 — recusa redirect de publico para loopback', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: emSequencia(
        corpo('', { location: 'http://127.0.0.1/interno' }, 302),
        corpo('<html>NUNCA</html>'),
      ),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('LOOPBACK');
  });

  it('recusa redirect para nome que resolve para privado', async () => {
    const misto: Resolvedor = (h) =>
      Promise.resolve([
        h === 'interno.exemplo'
          ? { address: '10.0.0.5', family: 4 as const }
          : { address: '93.184.216.34', family: 4 as const },
      ]);
    const r = await buscar('http://exemplo.com.br/', {
      resolver: misto,
      transporte: emSequencia(
        corpo('', { location: 'http://interno.exemplo/' }, 302),
        corpo('NUNCA'),
      ),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('PRIVADO');
  });

  it('segue Location relativo e atualiza a URL final', async () => {
    const r = await buscar('http://exemplo.com.br/velho', {
      resolver: publico,
      transporte: emSequencia(
        corpo('', { location: '/novo' }, 301),
        corpo('<html>final</html>'),
      ),
    });
    expect(r.ok && r.urlFinal).toBe('http://exemplo.com.br/novo');
    expect(r.ok && r.saltos).toBe(1);
  });

  /**
   * A cadeia real do `gov.br`, medida em 25/08: apex → https → www → locale.
   *
   * Com o teto antigo de 3 ela passava raspando, e **um salto a mais falhava**
   * — reportando site no ar como inalcancavel. E o caso que motivou subir o
   * teto para 5, e por isso ele tem teste com nome proprio.
   */
  it('a cadeia de quatro saltos do gov.br chega ao corpo', async () => {
    const r = await buscar('http://gov.br/', {
      resolver: publico,
      transporte: emSequencia(
        corpo('', { location: 'https://gov.br/' }, 301),
        corpo('', { location: 'https://www.gov.br/' }, 301),
        corpo('', { location: 'https://www.gov.br/pt-br' }, 302),
        corpo('', { location: 'https://www.gov.br/pt-br/' }, 301),
        corpo('<html>final</html>'),
      ),
    });
    expect(r.ok && r.urlFinal).toBe('https://www.gov.br/pt-br/');
    expect(r.ok && r.saltos).toBe(4);
  });

  it('corta acima de cinco saltos', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => Promise.resolve(corpo('', { location: '/mais' }, 302)),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('REDIRECT_DEMAIS');
  });

  it('o guard revalida no ultimo salto, nao so nos primeiros', async () => {
    // Subir o teto nao pode abrir uma janela: o S4 — publico para loopback —
    // tem de morrer no salto onde acontecer, seja o segundo ou o quinto.
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: emSequencia(
        corpo('', { location: 'http://exemplo.com.br/a' }, 301),
        corpo('', { location: 'http://exemplo.com.br/b' }, 301),
        corpo('', { location: 'http://exemplo.com.br/c' }, 301),
        corpo('', { location: 'http://127.0.0.1/interno' }, 301),
        corpo('<html>nunca chega</html>'),
      ),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('LOOPBACK');
  });

  it('recusa redirect sem Location', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => Promise.resolve(corpo('', {}, 302)),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('REDIRECT_SEM_DESTINO');
  });
});

describe('orcamento e falha', () => {
  it('esgota o orcamento do job antes de estourar os saltos', async () => {
    let relogio = 0;
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => {
        relogio += 12_000;
        return Promise.resolve(corpo('', { location: '/x' }, 302));
      },
      agora: () => relogio,
      orcamentoMs: 30_000,
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('ORCAMENTO_ESGOTADO');
  });

  it('erro de transporte sai uniforme', async () => {
    // Recusa, timeout e falha de TLS precisam ser indistinguiveis (§2.8).
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('TRANSPORTE_FALHOU');
  });

  it('a bomba de gzip morre aqui tambem', async () => {
    const r = await buscar('http://exemplo.com.br/', {
      resolver: publico,
      transporte: () =>
        Promise.resolve({
          status: 200,
          headers: { 'content-encoding': 'gzip' },
          corpo: um(gzipSync(Buffer.alloc(64 * 1024 * 1024, 0))),
        }),
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('DESCOMPRIMIDO_GRANDE');
  }, 30_000);

  it('recusa o destino inicial sem chamar o transporte', async () => {
    let chamou = false;
    const r = await buscar('http://127.0.0.1/', {
      resolver: publico,
      transporte: () => {
        chamou = true;
        return Promise.resolve(corpo('ok'));
      },
    });
    expect(r.ok ? 'passou' : r.motivo).toBe('LOOPBACK');
    expect(chamou).toBe(false);
  });
});
