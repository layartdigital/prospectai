import { avaliarEndereco, type MotivoBloqueio } from './ip-ranges';

/**
 * Decide se uma URL de terceiro pode ser buscada, e para qual IP conectar.
 *
 * `SECURITY-EGRESS-POLICY-v3.md` §2.2. A entrada e `Lead.website` — o que a
 * empresa cadastrou no Google Maps —, entao nada aqui pode assumir boa fe.
 *
 * **A ordem das checagens e o desenho.** Forma antes de resolucao: recusar por
 * scheme ou porta nao gasta uma consulta DNS nem revela ao atacante que o nome
 * dele foi consultado.
 *
 * O que este modulo NAO faz: nao conecta. Devolve o IP para quem conecta, e e
 * isso que fecha a janela de DNS rebinding — entre validar e conectar nao ha
 * segunda resolucao que possa devolver outra coisa (§2.2, regra 2).
 */

export type MotivoRecusa =
  | MotivoBloqueio
  | 'URL_MALFORMADA'
  | 'SCHEME_PROIBIDO'
  | 'PORTA_PROIBIDA'
  | 'CREDENCIAL_NA_URL'
  | 'DNS_SEM_RESPOSTA'
  | 'DNS_FALHOU';

export interface EnderecoResolvido {
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Resolve um nome em todos os enderecos conhecidos.
 *
 * Injetado em vez de importado para que os testes de rebinding e de resposta
 * mista sejam deterministicos. **Isso prova a logica, nao a rede** — a propria
 * politica avisa que teste contra resolvedor falso passa trivialmente, e o
 * teste com resolucao real fica no checklist de deploy.
 */
export type Resolvedor = (hostname: string) => Promise<EnderecoResolvido[]>;

export type ValidacaoUrl =
  | {
      permitido: true;
      /** Conectar AQUI. O hostname vai apenas em `Host` e SNI. */
      ip: string;
      familia: 4 | 6;
      hostname: string;
      porta: number;
      url: URL;
    }
  | { permitido: false; motivo: MotivoRecusa };

const SCHEMES = new Set(['http:', 'https:']);
const PORTAS = new Set([80, 443]);

/** Remove os colchetes que a URL usa para literal IPv6: `[::1]` -> `::1`. */
function semColchetes(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export async function validarUrl(
  bruta: string,
  resolver: Resolvedor,
): Promise<ValidacaoUrl> {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return { permitido: false, motivo: 'URL_MALFORMADA' };
  }

  if (!SCHEMES.has(url.protocol)) {
    return { permitido: false, motivo: 'SCHEME_PROIBIDO' };
  }

  // `https://user:senha@host/` nao e recusado por pudor: o §3 proibe que a
  // credencial chegue a `sourceReference`, e o caminho mais seguro para isso e
  // ela nunca entrar no pipeline. Site legitimo nao pede credencial na URL.
  if (url.username !== '' || url.password !== '') {
    return { permitido: false, motivo: 'CREDENCIAL_NA_URL' };
  }

  const porta = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!PORTAS.has(porta)) {
    return { permitido: false, motivo: 'PORTA_PROIBIDA' };
  }

  const hostname = semColchetes(url.hostname);
  if (hostname === '') {
    return { permitido: false, motivo: 'URL_MALFORMADA' };
  }

  // Literal de IP nao passa por DNS. Vai direto a tabela de faixas — que ja
  // normaliza mapped, NAT64 e 6to4.
  const comoLiteral = avaliarEndereco(hostname);
  if (comoLiteral.permitido) {
    return {
      permitido: true,
      ip: comoLiteral.ip,
      familia: comoLiteral.familia,
      hostname,
      porta,
      url,
    };
  }
  if (comoLiteral.motivo !== 'NAO_E_IP') {
    return { permitido: false, motivo: comoLiteral.motivo };
  }

  // Daqui para baixo e nome. O ponto final de FQDN (`postgres.`) chega intacto
  // ao resolvedor de proposito: a v1 tentou trata-lo por regra de string, e
  // regra de string foi o que este documento inteiro existe para substituir.
  let enderecos: EnderecoResolvido[];
  try {
    enderecos = await resolver(hostname);
  } catch {
    // Fail-closed. NXDOMAIN, SERVFAIL e timeout sao indistinguiveis aqui, e a
    // §2.8 exige que continuem indistinguiveis para quem chamou.
    return { permitido: false, motivo: 'DNS_FALHOU' };
  }

  if (enderecos.length === 0) {
    return { permitido: false, motivo: 'DNS_SEM_RESPOSTA' };
  }

  // **Todos** os enderecos precisam passar, nao o primeiro.
  //
  // Uma resposta com um IP publico e um privado e o ataque, nao o acidente: o
  // Happy Eyeballs do Node tenta os demais quando o primeiro demora, entao
  // validar so o primeiro deixa o segundo alcancavel.
  let escolhido: { ip: string; familia: 4 | 6 } | null = null;

  for (const { address } of enderecos) {
    const decisao = avaliarEndereco(address);
    if (!decisao.permitido) return { permitido: false, motivo: decisao.motivo };
    escolhido ??= { ip: decisao.ip, familia: decisao.familia };
  }

  if (escolhido === null) {
    return { permitido: false, motivo: 'DNS_SEM_RESPOSTA' };
  }

  return { permitido: true, ...escolhido, hostname, porta, url };
}
