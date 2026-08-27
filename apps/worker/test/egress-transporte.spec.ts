import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Destino } from '../src/egress/fetcher';
import { lerCorpo } from '../src/egress/limites';
import {
  criarTransporte,
  ErroTransporte,
  traduzirErro,
  USER_AGENT_PADRAO,
} from '../src/egress/transporte';

/**
 * Transporte — `SECURITY-EGRESS-POLICY-v3.md` §2.2 regra 2 e §2.5.
 *
 * **Aqui ha socket de verdade.** O resto do modulo e provado contra dublê, o
 * que prova a logica; este arquivo e o unico que prova que a logica sobrevive a
 * uma conexao. O servidor sobe em 127.0.0.1 — que o `guard` bloquearia, e por
 * isso mesmo estes testes chamam o transporte direto, sem passar por ele.
 *
 * O que continua **nao** provado, de proposito: TLS real. Gerar certificado em
 * teste exige guardar chave no repositorio, e chave em repositorio e coisa que
 * varredor de segredo acha e ninguem consegue explicar depois. A tabela de
 * traducao de erro e exercitada com codigos sinteticos; o handshake fica no
 * checklist do primeiro deploy.
 */

let servidor: Server;
let porta = 0;

/** Trocado por teste. O servidor sobe uma vez; o comportamento e que varia. */
let responder: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
  res.end('ok');
};

beforeAll(async () => {
  servidor = createServer((req, res) => responder(req, res));
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => {
    servidor.closeAllConnections?.();
    servidor.close(() => r());
  });
});

function destino(extra: Partial<Destino> = {}): Destino {
  return {
    ip: '127.0.0.1',
    familia: 4,
    hostname: 'exemplo.com.br',
    porta,
    https: false,
    caminho: '/',
    timeoutMs: 2_000,
    ...extra,
  };
}

async function juntar(corpo: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of corpo) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

const transporte = criarTransporte();

describe('busca basica sobre socket real', () => {
  it('devolve status, cabecalhos e corpo', async () => {
    responder = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html>oi</html>');
    };
    const r = await transporte(destino());
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect((await juntar(r.corpo)).toString()).toBe('<html>oi</html>');
  });

  it('leva o caminho e a query pedidos', async () => {
    let visto = '';
    responder = (req, res) => {
      visto = req.url ?? '';
      res.end('ok');
    };
    const r = await transporte(destino({ caminho: '/contato?utm=x' }));
    await juntar(r.corpo);
    expect(visto).toBe('/contato?utm=x');
  });

  it('caminho vazio vira /', async () => {
    let visto = '';
    responder = (req, res) => {
      visto = req.url ?? '';
      res.end('ok');
    };
    const r = await transporte(destino({ caminho: '' }));
    await juntar(r.corpo);
    expect(visto).toBe('/');
  });

  it('status 204 sem corpo nao trava', async () => {
    responder = (_req, res) => {
      res.writeHead(204);
      res.end();
    };
    const r = await transporte(destino());
    expect(r.status).toBe(204);
    expect((await juntar(r.corpo)).byteLength).toBe(0);
  });
});

describe('o socket vai para o IP validado, e o nome so no cabecalho', () => {
  /**
   * O teste central do arquivo.
   *
   * O hostname e `.invalid` — a RFC 6761 garante que nao resolve. Se o
   * transporte consultasse DNS em qualquer ponto, isto falharia. Ele conecta,
   * logo o `lookup` fixo esta no caminho: **entre validar e conectar nao existe
   * segunda resolucao para envenenar.**
   */
  it('conecta mesmo com hostname que nao resolve', async () => {
    let host = '';
    responder = (req, res) => {
      host = req.headers.host ?? '';
      res.end('ok');
    };
    const r = await transporte(
      destino({ hostname: 'nao-existe-mesmo.invalid' }),
    );
    await juntar(r.corpo);
    expect(r.status).toBe(200);
    expect(host).toBe(`nao-existe-mesmo.invalid:${porta}`);
  });

  it('o Host e o nome, nunca o IP', async () => {
    let host = '';
    responder = (req, res) => {
      host = req.headers.host ?? '';
      res.end('ok');
    };
    const r = await transporte(destino());
    await juntar(r.corpo);
    expect(host.startsWith('exemplo.com.br:')).toBe(true);
    expect(host).not.toContain('127.0.0.1');
  });
});

describe('cabecalhos enviados', () => {
  it('identifica o bot e nao manda cookie nem credencial', async () => {
    let recebidos: IncomingMessage['headers'] = {};
    responder = (req, res) => {
      recebidos = req.headers;
      res.end('ok');
    };
    const r = await transporte(destino());
    await juntar(r.corpo);
    expect(recebidos['user-agent']).toBe(USER_AGENT_PADRAO);
    expect(recebidos['cookie']).toBeUndefined();
    expect(recebidos['authorization']).toBeUndefined();
    expect(recebidos['referer']).toBeUndefined();
  });

  it('anuncia so os encodings que o lerCorpo desfaz', async () => {
    let aceito = '';
    responder = (req, res) => {
      aceito = req.headers['accept-encoding'] ?? '';
      res.end('ok');
    };
    const r = await transporte(destino());
    await juntar(r.corpo);
    expect(aceito).toBe('gzip, deflate, br');
  });

  it('user agent e sobrescrevivel', async () => {
    let ua = '';
    responder = (req, res) => {
      ua = req.headers['user-agent'] ?? '';
      res.end('ok');
    };
    const r = await criarTransporte({ userAgent: 'Outro/2.0' })(destino());
    await juntar(r.corpo);
    expect(ua).toBe('Outro/2.0');
  });
});

describe('cabecalhos recebidos', () => {
  it('achata cabecalho repetido em uma string', async () => {
    responder = (_req, res) => {
      res.setHeader('set-cookie', ['a=1', 'b=2']);
      res.end('ok');
    };
    const r = await transporte(destino());
    await juntar(r.corpo);
    expect(r.headers['set-cookie']).toBe('a=1, b=2');
  });

  it('preserva content-encoding para o lerCorpo', async () => {
    const html = Buffer.from(`<html>${'a'.repeat(5_000)}</html>`);
    responder = (_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(gzipSync(html));
    };
    const r = await transporte(destino());
    const lido = await lerCorpo(r.corpo, r.headers['content-encoding']);
    expect(lido.ok && lido.bytes.equals(html)).toBe(true);
  });
});

describe('o transporte nao segue redirect', () => {
  /**
   * Seguir aqui seria fatal: cada salto precisa voltar ao `guard`, e um
   * redirect seguido dentro do transporte pularia a revalidacao inteira — o
   * caminho S4, de publico para loopback, passaria sem ser olhado.
   */
  it('devolve o 302 cru, com Location', async () => {
    responder = (_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1/interno' });
      res.end();
    };
    const r = await transporte(destino());
    await juntar(r.corpo);
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('http://127.0.0.1/interno');
  });
});

describe('prazo', () => {
  it('estoura quando o servidor nunca responde', async () => {
    responder = () => {
      /* silencio proposital: nem cabecalho */
    };
    const erro = await transporte(destino({ timeoutMs: 300 })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroTransporte);
    expect((erro as ErroTransporte).codigo).toBe('TIMEOUT');
  });

  /**
   * Slowloris de corpo — o caso que um timeout de ociosidade nao pega.
   *
   * Cabecalhos saem na hora; o corpo goteja um byte por vez. Como cada byte
   * reinicia o relogio de ociosidade, so um prazo absoluto encerra isto. E o
   * corte tem de sair como `LEITURA_INTERROMPIDA`, nao como problema de
   * tamanho: sao 60 bytes, longe de qualquer teto.
   */
  it('corta corpo que goteja, e o lerCorpo nao lanca', async () => {
    responder = (_req, res) => {
      res.writeHead(200);
      let n = 0;
      const t = setInterval(() => {
        if (n++ > 60) return;
        res.write('x');
      }, 40);
      res.on('close', () => clearInterval(t));
    };
    const r = await transporte(destino({ timeoutMs: 400 }));
    expect(r.status).toBe(200);
    const lido = await lerCorpo(r.corpo, r.headers['content-encoding']);
    expect(lido.ok ? 'leu tudo' : lido.motivo).toBe('LEITURA_INTERROMPIDA');
  });

  it('corpo interrompido no meio sai como LEITURA_INTERROMPIDA', async () => {
    responder = (_req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('parcial');
      setTimeout(() => res.destroy(), 30);
    };
    const r = await transporte(destino());
    const lido = await lerCorpo(r.corpo, r.headers['content-encoding']);
    expect(lido.ok ? 'leu tudo' : lido.motivo).toBe('LEITURA_INTERROMPIDA');
  });

  it('corpo comprimido interrompido nao vira DESCOMPRIMIDO_GRANDE', async () => {
    const html = Buffer.from(`<html>${'a'.repeat(200_000)}</html>`);
    const comprimido = gzipSync(html);
    responder = (_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.write(comprimido.subarray(0, 40));
      setTimeout(() => res.destroy(), 30);
    };
    const r = await transporte(destino());
    const lido = await lerCorpo(r.corpo, r.headers['content-encoding']);
    // O rotulo importa: erro de rede rotulado como bomba viraria evento de
    // seguranca falso no log, e o log e o unico lugar onde o motivo sobrevive.
    expect(lido.ok ? 'leu tudo' : lido.motivo).toBe('LEITURA_INTERROMPIDA');
  });
});

describe('descartar solta o socket sem ler o corpo', () => {
  it('fecha a conexao que um redirect abandonaria', async () => {
    let fechou = false;
    responder = (_req, res) => {
      res.writeHead(302, { location: '/outro' });
      res.write('corpo que ninguem vai ler');
      res.on('close', () => {
        fechou = true;
      });
    };
    const r = await transporte(destino());
    expect(r.descartar).toBeTypeOf('function');
    r.descartar?.();
    await new Promise((r2) => setTimeout(r2, 150));
    expect(fechou).toBe(true);
  });
});

describe('falhas de conexao', () => {
  it('porta fechada vira CONEXAO_RECUSADA', async () => {
    // Porta 1 em loopback: privilegiada e sem nada escutando.
    const erro = await transporte(destino({ porta: 1, timeoutMs: 2_000 })).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroTransporte);
    expect(['CONEXAO_RECUSADA', 'REDE_INALCANCAVEL']).toContain(
      (erro as ErroTransporte).codigo,
    );
  });

  it('reset antes dos cabecalhos vira CONEXAO_PERDIDA', async () => {
    responder = (_req, res) => {
      res.socket?.destroy();
    };
    const erro = await transporte(destino()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroTransporte);
    expect((erro as ErroTransporte).codigo).toBe('CONEXAO_PERDIDA');
  });
});

describe('traducao de erro do Node', () => {
  const caso = (code: string): string => traduzirErro(Object.assign(new Error(code), { code })).codigo;

  it('ECONNREFUSED', () => expect(caso('ECONNREFUSED')).toBe('CONEXAO_RECUSADA'));
  it('ETIMEDOUT', () => expect(caso('ETIMEDOUT')).toBe('TIMEOUT'));
  it('ECONNRESET', () => expect(caso('ECONNRESET')).toBe('CONEXAO_PERDIDA'));
  it('EHOSTUNREACH', () => expect(caso('EHOSTUNREACH')).toBe('REDE_INALCANCAVEL'));

  // Estes quatro sao o achado vendavel da checagem HTTPS: sem codigo proprio
  // seriam indistinguiveis de "site fora do ar".
  it('CERT_HAS_EXPIRED', () =>
    expect(caso('CERT_HAS_EXPIRED')).toBe('TLS_CERTIFICADO_EXPIRADO'));
  it('ERR_TLS_CERT_ALTNAME_INVALID', () =>
    expect(caso('ERR_TLS_CERT_ALTNAME_INVALID')).toBe('TLS_NOME_NAO_CONFERE'));
  it('DEPTH_ZERO_SELF_SIGNED_CERT', () =>
    expect(caso('DEPTH_ZERO_SELF_SIGNED_CERT')).toBe('TLS_AUTOASSINADO'));
  it('UNABLE_TO_VERIFY_LEAF_SIGNATURE', () =>
    expect(caso('UNABLE_TO_VERIFY_LEAF_SIGNATURE')).toBe('TLS_INVALIDO'));

  it('prefixo HPE_ vira RESPOSTA_INVALIDA', () =>
    expect(caso('HPE_INVALID_HEADER_TOKEN')).toBe('RESPOSTA_INVALIDA'));
  it('prefixo ERR_TLS desconhecido cai em TLS_INVALIDO', () =>
    expect(caso('ERR_TLS_HANDSHAKE_TIMEOUT')).toBe('TLS_INVALIDO'));
  it('codigo que ninguem previu vira DESCONHECIDO', () =>
    expect(caso('EALGUMACOISANOVA')).toBe('DESCONHECIDO'));
  it('erro sem code vira DESCONHECIDO', () =>
    expect(traduzirErro(new Error('sem code')).codigo).toBe('DESCONHECIDO'));
  it('ErroTransporte passa intacto', () =>
    expect(traduzirErro(new ErroTransporte('TIMEOUT')).codigo).toBe('TIMEOUT'));
});
