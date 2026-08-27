import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SiteCheckResult } from '@propectai/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EnderecoResolvido } from '../src/egress/guard';
import { criarTransporte } from '../src/egress/transporte';
import { MockSiteAuditProvider } from '../src/providers/site-audit/mock.provider';
import { NativeSiteAuditProvider } from '../src/providers/site-audit/native.provider';

/**
 * Auditoria de presenca digital, v1 — quatro checagens.
 *
 * O transporte e real; o resolvedor e injetado e aponta para o servidor local.
 * Nao ha como usar o resolvedor de producao aqui: o `guard` bloqueia loopback,
 * corretamente, e e por isso que a prova ponta a ponta contra alvo publico fica
 * no checklist de deploy.
 */

/**
 * **Dois servidores, e o `https` aqui e encenado.**
 *
 * O transporte de teste roteia por `destino.https`: a sonda http cai no
 * `servidor`, a sonda https cai no `servidorSeguro`. Nenhum dos dois fala TLS —
 * a porta segura e HTTP simples atras de um roteamento.
 *
 * Isso e proposital e precisa estar escrito, porque um servidor so faria estes
 * testes passarem pelo motivo errado: com http e https caindo no mesmo lugar, a
 * cadeia de redirect volta para si mesma e morre em `REDIRECT_DEMAIS` — e as
 * assercoes de status e contagem de checagens continuariam verdes sem provar
 * nada sobre a subida para https. A primeira versao deste arquivo fazia
 * exatamente isso.
 *
 * O que aqui se prova e a **logica do provider**. TLS de verdade e do
 * `egress-transporte.spec.ts` e do checklist de deploy.
 */
let servidor: Server;
let servidorSeguro: Server;
let porta = 0;
let portaSegura = 0;

let responder: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end('ok');
let responderSeguro: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) =>
  res.end('ok');

beforeAll(async () => {
  servidor = createServer((req, res) => responder(req, res));
  servidorSeguro = createServer((req, res) => responderSeguro(req, res));
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => servidorSeguro.listen(0, '127.0.0.1', r));
  porta = (servidor.address() as AddressInfo).port;
  portaSegura = (servidorSeguro.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const s of [servidor, servidorSeguro]) {
    await new Promise<void>((r) => {
      s.closeAllConnections?.();
      s.close(() => r());
    });
  }
});

const naoResolve = async (): Promise<EnderecoResolvido[]> => {
  throw new Error('NXDOMAIN');
};

/**
 * O `guard` bloqueia 127.0.0.1, entao a auditoria nao pode usar o transporte
 * real contra ele por dentro do `buscar`. Aqui o guard e contornado no unico
 * ponto onde e seguro: o resolvedor devolve um IP publico ficticio, e o
 * transporte redireciona o socket para a porta local.
 */
const paraPublicoFicticio = async (): Promise<EnderecoResolvido[]> => [
  { address: '93.184.216.34', family: 4 },
];

function auditor(resolver = paraPublicoFicticio) {
  const real = criarTransporte();
  return new NativeSiteAuditProvider({
    resolver,
    // Roteia pelo esquema pedido e desliga o TLS: a "porta segura" e o segundo
    // servidor, nao um handshake. Ver a nota no topo do arquivo.
    transporte: (d) =>
      real({
        ...d,
        ip: '127.0.0.1',
        porta: d.https ? portaSegura : porta,
        https: false,
      }),
  });
}

function achar(checks: SiteCheckResult[], nome: string): SiteCheckResult {
  const c = checks.find((x) => x.check === nome);
  if (c === undefined) throw new Error(`checagem ${nome} ausente`);
  return c;
}

describe('site que sobe para https', () => {
  it('as quatro passam, e a subida e medida na cadeia', async () => {
    responder = (_req, res) => {
      res.writeHead(301, { location: 'https://exemplo.com.br/' });
      res.end();
    };
    responderSeguro = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>ok</html>');
    };

    const r = await auditor().auditar({ website: 'exemplo.com.br' });

    expect(r.status).toBe('COMPLETED');
    expect(achar(r.checks, 'DNS').outcome).toBe('OK');
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('OK');
    expect(achar(r.checks, 'HTTPS').outcome).toBe('OK');
    const cadeia = achar(r.checks, 'REDIRECT_CHAIN');
    expect(cadeia.outcome).toBe('OK');
    // A medicao que substitui o `raw.startsWith('https://')` do `normalize.ts`.
    expect(cadeia.result?.['forcaHttps']).toBe(true);
    expect(cadeia.result?.['saltos']).toBe(1);
    // E a URL observada tem de ser a de destino, nao a sondada.
    expect(achar(r.checks, 'HTTPS').observedUrl).toBe('https://exemplo.com.br/');
  });

  it('uma sonda basta quando a subida acontece', async () => {
    let sondasSeguras = 0;
    responder = (_req, res) => {
      res.writeHead(308, { location: 'https://exemplo.com.br/' });
      res.end();
    };
    responderSeguro = (_req, res) => {
      sondasSeguras++;
      res.end('<html>ok</html>');
    };

    await auditor().auditar({ website: 'exemplo.com.br' });
    // A segunda sonda nao e disparada: o salto ja terminou em https, e a
    // requisicao extra seria custo puro contra o site do cliente.
    expect(sondasSeguras).toBe(1);
  });
});

describe('site sem https', () => {
  it('HTTPS reprova e REDIRECT_CHAIN registra que nao forca', async () => {
    responder = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>http puro</html>');
    };
    // Porta 443 fechada: a sonda segura nao encontra ninguem.
    responderSeguro = (_req, res) => res.socket?.destroy();
    const r = await auditor().auditar({ website: 'http://semtls.com.br' });

    expect(r.status).toBe('COMPLETED');
    expect(achar(r.checks, 'DNS').outcome).toBe('OK');
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('OK');
    // A segunda sonda tambem responde 200, mas em http — o `urlFinal` nunca
    // vira https, entao a checagem reprova. E o achado que se vende.
    expect(achar(r.checks, 'HTTPS').outcome).toBe('FAILED');
    expect(achar(r.checks, 'REDIRECT_CHAIN').result?.['forcaHttps']).toBe(false);
  });

  it('reprovar em tudo ainda e auditoria COMPLETED', async () => {
    responder = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    responderSeguro = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    const r = await auditor().auditar({ website: 'quebrado.com.br' });

    // A distincao que evita o BullMQ repetir tres vezes para chegar a mesma
    // conclusao correta: o site falhou, nos nao.
    expect(r.status).toBe('COMPLETED');
    expect(r.errorCode).toBe(null);
    // **As tres linhas que faltavam.** A versao anterior deste teste tinha o
    // nome "reprovar em tudo" e nao afirmava que nada reprovava — e ainda
    // herdava o `responderSeguro` do teste anterior, passando por ordem.
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('FAILED');
    expect(achar(r.checks, 'HTTP_REACHABLE').errorCode).toBe('ERRO_DO_SERVIDOR');
    expect(achar(r.checks, 'HTTP_REACHABLE').result?.['status']).toBe(500);
  });
});

describe('classe do status, que a v1 nao olhava', () => {
  /**
   * O defeito que o smoke test contra a internet achou em dez minutos: as
   * checagens ignoravam o codigo de status. Site com 500 em toda pagina passava
   * nas quatro, e o relatorio dizia que a presenca digital estava saudavel.
   */
  it('2xx serve, e a cadeia e conclusiva', async () => {
    responder = (_req, res) => {
      res.writeHead(200);
      res.end('<html>ok</html>');
    };
    responderSeguro = (_req, res) => res.socket?.destroy();
    const r = await auditor().auditar({ website: 'serve.com.br' });

    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('OK');
    expect(achar(r.checks, 'REDIRECT_CHAIN').outcome).toBe('OK');
    expect(achar(r.checks, 'REDIRECT_CHAIN').result?.['forcaHttps']).toBe(false);
  });

  it('5xx reprova, porque o erro e do proprio site', async () => {
    responder = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    responderSeguro = (_req, res) => {
      res.writeHead(503);
      res.end();
    };
    const r = await auditor().auditar({ website: 'caiu.com.br' });
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('FAILED');
  });

  /**
   * O caso da regra 4. O nosso `User-Agent` se identifica como bot, e WAF de
   * site pequeno responde 403 a bot o tempo todo. Chamar isso de "site fora do
   * ar" seria falso negativo — nao medimos o site, medimos uma recusa a ser
   * medido.
   */
  for (const status of [401, 403, 404, 429]) {
    it(`${status} nao reprova nem aprova: fica SKIPPED`, async () => {
      responder = (_req, res) => {
        res.writeHead(status);
        res.end();
      };
      responderSeguro = (_req, res) => {
        res.writeHead(status);
        res.end();
      };
      const r = await auditor().auditar({ website: `bloqueado-${status}.com.br` });

      const alcance = achar(r.checks, 'HTTP_REACHABLE');
      expect(alcance.outcome).toBe('SKIPPED');
      expect(alcance.errorCode).toBe('RESPOSTA_NAO_CONCLUSIVA');
      // O numero fica gravado mesmo quando a checagem nao conclui: e o que
      // permite rever a classificacao com dado em vez de opiniao.
      expect(alcance.result?.['status']).toBe(status);
    });
  }

  it('sonda http inconclusiva nao afirma que o site aceita trafego em claro', async () => {
    // O caso exato que o smoke test mostrou: sem redirect observado e sem
    // resposta conclusiva, `forcaHttps: false` seria achado inventado.
    responder = (_req, res) => {
      res.writeHead(403);
      res.end();
    };
    responderSeguro = (_req, res) => {
      res.writeHead(403);
      res.end();
    };
    const r = await auditor().auditar({ website: 'waf.com.br' });

    const cadeia = achar(r.checks, 'REDIRECT_CHAIN');
    expect(cadeia.outcome).toBe('SKIPPED');
    expect(cadeia.errorCode).toBe('SONDA_HTTP_NAO_CONCLUSIVA');
    expect(cadeia.result?.['forcaHttps']).toBeUndefined();
  });

  it('redirect observado e conclusivo mesmo com status final ruim', async () => {
    // Se o salto aconteceu, ele aconteceu. O que o destino respondeu depois
    // nao desfaz a observacao.
    responder = (_req, res) => {
      res.writeHead(301, { location: 'https://subiu.com.br/' });
      res.end();
    };
    responderSeguro = (_req, res) => {
      res.writeHead(403);
      res.end();
    };
    const r = await auditor().auditar({ website: 'subiu.com.br' });

    const cadeia = achar(r.checks, 'REDIRECT_CHAIN');
    expect(cadeia.outcome).toBe('OK');
    expect(cadeia.result?.['forcaHttps']).toBe(true);
    // E o TLS continua valido: certificado e transporte, nao aplicacao.
    expect(achar(r.checks, 'HTTPS').outcome).toBe('OK');
  });
});

describe('redirect para destino quebrado', () => {
  /**
   * O caso que o smoke test contra `expired.badssl.com` revelou.
   *
   * A porta 80 atende e manda para https; o https e que esta quebrado. O
   * resultado antigo afirmava tres coisas falsas de uma vez: `porta80: false`
   * (a porta atendeu), `saltos: 0` (houve um salto) e o mesmo `errorCode` de
   * TLS em duas checagens, fazendo o relatorio contar a mesma causa duas vezes.
   */
  const soDerruba = (): void => {
    responder = (_req, res) => {
      res.writeHead(301, { location: 'https://quebrado.com.br/' });
      res.end();
    };
    responderSeguro = (_req, res) => res.socket?.destroy();
  };

  it('a porta 80 atendeu, e o resultado tem de dizer isso', async () => {
    soDerruba();
    const r = await auditor().auditar({ website: 'quebrado.com.br' });
    // Afirmar o contrario do que se observou e pior que nao afirmar nada.
    expect(achar(r.checks, 'HTTP_REACHABLE').result?.['porta80']).toBe(true);
  });

  it('o salto observado nao e apagado pela falha seguinte', async () => {
    soDerruba();
    const r = await auditor().auditar({ website: 'quebrado.com.br' });
    expect(achar(r.checks, 'REDIRECT_CHAIN').result?.['saltos']).toBe(1);
  });

  it('as duas checagens contam historias diferentes, nao a mesma duas vezes', async () => {
    soDerruba();
    const r = await auditor().auditar({ website: 'quebrado.com.br' });

    const alcance = achar(r.checks, 'HTTP_REACHABLE');
    const tls = achar(r.checks, 'HTTPS');
    expect(alcance.errorCode).toBe('REDIRECT_PARA_DESTINO_QUEBRADO');
    expect(tls.outcome).toBe('FAILED');
    expect(alcance.errorCode === tls.errorCode).toBe(false);
  });

  it('falha no primeiro salto continua dizendo que a porta 80 nao atendeu', async () => {
    // O contraste que prova que a correcao nao virou um `true` fixo.
    responder = (_req, res) => res.socket?.destroy();
    responderSeguro = (_req, res) => res.socket?.destroy();
    const r = await auditor().auditar({ website: 'morto.com.br' });
    expect(achar(r.checks, 'HTTP_REACHABLE').result?.['porta80']).toBe(false);
  });
});

describe('dominio que nao resolve', () => {
  it('DNS reprova, os outros tres ficam SKIPPED, e o status e COMPLETED', async () => {
    const r = await auditor(naoResolve).auditar({ website: 'nao-existe.com.br' });

    expect(achar(r.checks, 'DNS').outcome).toBe('FAILED');
    expect(achar(r.checks, 'DNS').errorCode).toBe('NAO_RESOLVE');
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('SKIPPED');
    expect(achar(r.checks, 'HTTPS').outcome).toBe('SKIPPED');
    expect(achar(r.checks, 'REDIRECT_CHAIN').outcome).toBe('SKIPPED');
    // "Esse dominio nao existe" e a medicao, nao a falta dela.
    expect(r.status).toBe('COMPLETED');
  });
});

describe('dominio que aponta para dentro', () => {
  it('separa destino bloqueado de dominio inexistente', async () => {
    const paraPrivado = async (): Promise<EnderecoResolvido[]> => [
      { address: '10.0.0.5', family: 4 },
    ];
    const r = await auditor(paraPrivado).auditar({ website: 'interno.com.br' });

    const dns = achar(r.checks, 'DNS');
    // O dominio resolve — so nao para um lugar que possamos visitar. Chamar
    // isso de "nao resolve" mandaria ao cliente um achado falso e esconderia
    // de nos o alerta de verdade.
    expect(dns.outcome).toBe('OK');
    expect(dns.errorCode).toBe('DESTINO_BLOQUEADO');
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('FAILED');
  });
});

describe('entrada', () => {
  it('website vazio nao vira auditoria', async () => {
    const r = await auditor().auditar({ website: '   ' });
    expect(r.status).toBe('FAILED');
    expect(r.errorCode).toBe('WEBSITE_INVALIDO');
    expect(r.checks.length).toBe(0);
  });

  it('aceita dominio sem esquema', async () => {
    responder = (_req, res) => res.end('ok');
    const r = await auditor().auditar({ website: '  semesquema.com.br  ' });
    expect(achar(r.checks, 'HTTP_REACHABLE').outcome).toBe('OK');
  });

  it('lixo que nao vira URL sai como WEBSITE_INVALIDO', async () => {
    const r = await auditor().auditar({ website: 'http://' });
    expect(r.errorCode).toBe('WEBSITE_INVALIDO');
  });
});

describe('nada da pagina e guardado', () => {
  it('a query string some da URL observada', async () => {
    responder = (_req, res) => res.end('<html>x</html>');
    const r = await auditor().auditar({
      website: 'http://captura.com.br/lp?email=maria@exemplo.com&cpf=00011122233',
    });

    for (const c of r.checks) {
      if (c.observedUrl === null) continue;
      expect(c.observedUrl).not.toContain('email=');
      expect(c.observedUrl).not.toContain('cpf=');
      expect(c.observedUrl).not.toContain('?');
    }
  });

  it('nenhum result carrega corpo de pagina', async () => {
    responder = (_req, res) => res.end('<html>SEGREDO-NA-PAGINA</html>');
    const r = await auditor().auditar({ website: 'conteudo.com.br' });
    expect(JSON.stringify(r.checks)).not.toContain('SEGREDO');
  });
});

describe('provider de mock', () => {
  const mock = new MockSiteAuditProvider();

  it('o mesmo site produz sempre a mesma auditoria', async () => {
    const a = await mock.auditar({ website: 'estavel.com.br' });
    const b = await mock.auditar({ website: 'estavel.com.br' });
    expect(a.checks.map((c) => `${c.check}:${c.outcome}`).join('|')).toBe(
      b.checks.map((c) => `${c.check}:${c.outcome}`).join('|'),
    );
  });

  it('sempre devolve as quatro checagens da v1', async () => {
    for (const site of ['a.com.br', 'b.com.br', 'c.com.br', 'd.com.br', 'e.com.br']) {
      const r = await mock.auditar({ website: site });
      expect(r.checks.length).toBe(4);
    }
  });

  it('website vazio nao vira auditoria, igual ao nativo', async () => {
    const r = await mock.auditar({ website: '' });
    expect(r.status).toBe('FAILED');
    expect(r.errorCode).toBe('WEBSITE_INVALIDO');
  });

  it('declara o mesmo auditVersion do nativo', async () => {
    const r = await mock.auditar({ website: 'x.com.br' });
    expect(r.auditVersion).toBe('audit-v1');
  });
});

describe('o mock produz a MESMA forma que o nativo', () => {
  /**
   * Rodar os dois lado a lado numa auditoria de verdade mostrou que nao
   * produziam. O mock gravava a URL inteira num campo `hostname`; o nativo
   * grava so o host. **Mock que diverge do real nao e um dublê — e uma segunda
   * implementacao errada**, e tudo construido sobre ela quebra na troca.
   */
  it('hostname e host, nunca a URL', async () => {
    responder = (_req, res) => res.end('<html>ok</html>');
    responderSeguro = (_req, res) => res.end('<html>ok</html>');

    const doNativo = await auditor().auditar({ website: 'https://exemplo.com.br/pagina' });
    const doMock = await new MockSiteAuditProvider().auditar({
      website: 'https://exemplo.com.br/pagina',
    });

    expect(achar(doMock.checks, 'DNS').result?.['hostname']).toBe('exemplo.com.br');
    expect(achar(doNativo.checks, 'DNS').result?.['hostname']).toBe('exemplo.com.br');
  });

  it('as duas implementacoes usam as mesmas chaves em cada checagem', async () => {
    responder = (_req, res) => res.end('<html>ok</html>');
    responderSeguro = (_req, res) => res.end('<html>ok</html>');

    const doNativo = await auditor().auditar({ website: 'https://exemplo.com.br/' });
    const doMock = await new MockSiteAuditProvider().auditar({ website: 'https://exemplo.com.br/' });

    for (const nome of ['DNS', 'HTTP_REACHABLE', 'HTTPS', 'REDIRECT_CHAIN']) {
      const a = achar(doNativo.checks, nome).result ?? {};
      const b = achar(doMock.checks, nome).result ?? {};
      expect(Object.keys(b).sort().join(',')).toBe(Object.keys(a).sort().join(','));
    }
  });

  it('observedUrl nao carrega query em nenhum dos dois', async () => {
    const doMock = await new MockSiteAuditProvider().auditar({
      website: 'http://captura.com.br/lp?email=maria@exemplo.com',
    });
    for (const c of doMock.checks) {
      if (c.observedUrl === null) continue;
      expect(c.observedUrl).not.toContain('?');
    }
  });
});
