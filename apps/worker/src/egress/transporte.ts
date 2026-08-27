import { request as pedirHttp, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { request as pedirHttps, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';

import type { Destino, RespostaBruta, Transporte } from './fetcher';

/**
 * Transporte real: abre o socket para o IP que o `guard` aprovou.
 *
 * `SECURITY-EGRESS-POLICY-v3.md` §2.2 regra 2 e §2.5. Ate aqui o modulo inteiro
 * estava provado contra um dublê — o que prova a logica e nao a rede. Este
 * arquivo e a peca que faltava, e o `Transporte` continua injetavel: quando o
 * processo isolado do ADR-004 Parte 2 existir, ele substitui este e nada acima
 * de `buscar()` muda.
 *
 * **O nucleo e o `lookup` fixo.** O socket vai para `destino.ip` — que ja
 * passou pela tabela de faixas — enquanto `Host` e SNI levam o hostname. Nao ha
 * segunda resolucao: e assim que o rebinding fecha sem depender de cache de
 * DNS. Um `lookup` que ignora o nome nao pode ser envenenado.
 */

/** Identificacao honesta. Bot que se esconde e bot que sera bloqueado. */
export const USER_AGENT_PADRAO = 'PropectAI-SiteAudit/1.0';

export type CodigoTransporte =
  | 'TIMEOUT'
  | 'CONEXAO_RECUSADA'
  | 'CONEXAO_PERDIDA'
  | 'REDE_INALCANCAVEL'
  | 'TLS_CERTIFICADO_EXPIRADO'
  | 'TLS_NOME_NAO_CONFERE'
  | 'TLS_AUTOASSINADO'
  | 'TLS_INVALIDO'
  | 'RESPOSTA_INVALIDA'
  | 'DESCONHECIDO';

/**
 * Erro com codigo, e o codigo nao e enfeite.
 *
 * A §2.8 exige resposta uniforme **ao usuario**; o log fica com o motivo. Para
 * a auditoria de presenca digital a distincao vale dinheiro: "certificado
 * expirado" e o achado mais vendavel que a checagem `HTTPS` pode produzir, e
 * sem o codigo ele seria indistinguivel de "site fora do ar".
 */
export class ErroTransporte extends Error {
  readonly codigo: CodigoTransporte;

  constructor(codigo: CodigoTransporte, causa?: string) {
    super(causa === undefined ? codigo : `${codigo} (${causa})`);
    this.name = 'ErroTransporte';
    this.codigo = codigo;
  }
}

const POR_CODIGO_NODE: Readonly<Record<string, CodigoTransporte>> = {
  ETIMEDOUT: 'TIMEOUT',
  ERR_SOCKET_CONNECTION_TIMEOUT: 'TIMEOUT',
  ECONNREFUSED: 'CONEXAO_RECUSADA',
  ECONNRESET: 'CONEXAO_PERDIDA',
  EPIPE: 'CONEXAO_PERDIDA',
  ERR_STREAM_PREMATURE_CLOSE: 'CONEXAO_PERDIDA',
  ENETUNREACH: 'REDE_INALCANCAVEL',
  EHOSTUNREACH: 'REDE_INALCANCAVEL',
  EAI_AGAIN: 'REDE_INALCANCAVEL',
  CERT_HAS_EXPIRED: 'TLS_CERTIFICADO_EXPIRADO',
  CERT_NOT_YET_VALID: 'TLS_CERTIFICADO_EXPIRADO',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS_NOME_NAO_CONFERE',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS_AUTOASSINADO',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS_AUTOASSINADO',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS_INVALIDO',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'TLS_INVALIDO',
  UNABLE_TO_GET_ISSUER_CERT: 'TLS_INVALIDO',
  CERT_UNTRUSTED: 'TLS_INVALIDO',
};

/**
 * Traduz o erro do Node para o vocabulario do modulo.
 *
 * Exposta para teste porque o caminho TLS real nao e testavel em unidade sem
 * gerar certificado — e certificado no repositorio e o tipo de coisa que
 * varredor de segredo acha e ninguem consegue explicar depois. A tabela e
 * exercitada com erros sinteticos; o handshake de verdade fica no checklist de
 * primeiro deploy, junto das outras provas que so a rede da.
 */
export function traduzirErro(bruto: unknown): ErroTransporte {
  if (bruto instanceof ErroTransporte) return bruto;

  const erro = bruto as NodeJS.ErrnoException | undefined;
  const codigo = typeof erro?.code === 'string' ? erro.code : '';

  const conhecido = POR_CODIGO_NODE[codigo];
  if (conhecido !== undefined) return new ErroTransporte(conhecido, codigo);

  // O parser de HTTP do Node prefixa tudo com `HPE_`. Resposta malformada e
  // resposta de servidor hostil sao a mesma coisa daqui.
  if (codigo.startsWith('HPE_')) return new ErroTransporte('RESPOSTA_INVALIDA', codigo);
  if (codigo.startsWith('ERR_TLS')) return new ErroTransporte('TLS_INVALIDO', codigo);

  return new ErroTransporte('DESCONHECIDO', codigo === '' ? undefined : codigo);
}

/**
 * Resolvedor que nao resolve: devolve sempre o endereco ja aprovado.
 *
 * Precisa atender as duas formas com que o `net` chama o `lookup`. Desde o Node
 * 20, com `autoSelectFamily` ligado por padrao, a chamada vem com `all: true` e
 * espera uma lista; a forma antiga espera `(endereco, familia)`. Atender so uma
 * funciona na versao de hoje e quebra na proxima.
 */
function lookupFixo(ip: string, familia: 4 | 6): LookupFunction {
  return (_hostname, opcoes, callback) => {
    if ((opcoes as { all?: boolean } | undefined)?.all === true) {
      callback(null, [{ address: ip, family: familia }]);
    } else {
      callback(null, ip, familia);
    }
  };
}

/**
 * `set-cookie` chega como lista; o resto como string. Junta com virgula, que e
 * a forma que a RFC 9110 define para cabecalho repetido.
 */
function achatar(cabecalhos: IncomingHttpHeaders): Record<string, string | undefined> {
  const saida: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(cabecalhos)) {
    if (valor === undefined) continue;
    saida[chave] = Array.isArray(valor) ? valor.join(', ') : valor;
  }
  return saida;
}

export interface OpcoesTransporte {
  readonly userAgent?: string;
}

export function criarTransporte(opcoes: OpcoesTransporte = {}): Transporte {
  const userAgent = opcoes.userAgent ?? USER_AGENT_PADRAO;
  return (destino) => abrir(destino, userAgent);
}

function abrir(destino: Destino, userAgent: string): Promise<RespostaBruta> {
  return new Promise<RespostaBruta>((resolve, reject) => {
    let respondeu = false;
    let encerradoPorPrazo = false;

    const pedidoOpcoes: RequestOptions = {
      // `hostname` e o nome, nao o IP: e dele que saem o `Host` e o SNI. Quem
      // decide o destino do socket e o `lookup` abaixo.
      hostname: destino.hostname,
      port: destino.porta,
      path: destino.caminho === '' ? '/' : destino.caminho,
      method: 'GET',
      // Sem pool. Duas buscas para o mesmo nome podem ter validado IPs
      // diferentes, e socket reaproveitado mandaria a segunda para o destino
      // da primeira — burlando a validacao sem que nada aqui parecesse errado.
      agent: false,
      lookup: lookupFixo(destino.ip, destino.familia),
      servername: destino.https ? destino.hostname : undefined,
      rejectUnauthorized: true,
      headers: {
        'user-agent': userAgent,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        // Exatamente o que o `limites.ts` sabe desfazer. Anunciar mais seria
        // pedir um corpo que so poderiamos recusar depois de baixar.
        'accept-encoding': 'gzip, deflate, br',
        // Nada de cookie, referer ou authorization: a busca e anonima por
        // desenho, e cada uma abre socket proprio.
        connection: 'close',
      },
    };

    const aoResponder = (res: IncomingMessage): void => {
      respondeu = true;
      // O prazo NAO e cancelado aqui. Ele cobre o corpo tambem — cancelar em
      // cima dos cabecalhos e o que deixa o slowloris passar.
      res.once('close', () => clearTimeout(prazo));
      resolve({
        status: res.statusCode ?? 0,
        headers: achatar(res.headers),
        corpo: res,
        // Quem recebe pode nao querer o corpo: redirect e recusa por tamanho
        // saem sem ler. Sem isto o socket ficaria aberto ate o prazo estourar,
        // e `agent: false` significa um socket por busca abandonada.
        descartar: () => {
          clearTimeout(prazo);
          res.destroy();
          req.destroy();
        },
      });
    };

    const req = destino.https
      ? pedirHttps(pedidoOpcoes, aoResponder)
      : pedirHttp(pedidoOpcoes, aoResponder);

    /**
     * Prazo unico para a troca inteira — conexao, TLS, cabecalhos e corpo.
     *
     * Nao e um timeout de ociosidade, e de proposito. Ociosidade nao pega o
     * servidor que envia um byte a cada 9 segundos: o relogio reinicia a cada
     * byte e a vaga do worker fica presa para sempre. E a mesma classe do hang
     * que o `limites.ts` ja custou uma vez, e a licao de la vale aqui —
     * **prender a vaga em silencio e pior que o DoS que o limite existe para
     * impedir.**
     *
     * O custo e recusar um site genuinamente lento. Para uma auditoria isso e
     * medicao, nao perda: site que nao entrega no prazo tem um achado a
     * reportar.
     */
    const prazo = setTimeout(() => {
      encerradoPorPrazo = true;
      req.destroy(new ErroTransporte('TIMEOUT'));
    }, destino.timeoutMs);

    req.on('error', (e: unknown) => {
      clearTimeout(prazo);
      // Depois dos cabecalhos a promessa ja foi resolvida. O erro segue vivo no
      // fluxo do corpo, onde o `lerCorpo` o converte em `LEITURA_INTERROMPIDA`.
      if (respondeu) return;
      reject(encerradoPorPrazo ? new ErroTransporte('TIMEOUT') : traduzirErro(e));
    });

    req.end();
  });
}
