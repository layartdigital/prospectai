import { isIP } from 'node:net';

/**
 * Decide se um endereco IP pode ser alcancado a partir do produto.
 *
 * **Este arquivo e a tabela do `SECURITY-EGRESS-POLICY-v3.md` §2.1 em codigo, e
 * as duas precisam ser lidas juntas.** A v1 da politica tinha o principio certo
 * — bloquear por resolucao, nao por string — e a tabela furada: um unico
 * revisor encontrou seis contornos. Cada um deles tem um teste nomeado aqui.
 *
 * O que este modulo NAO faz, de proposito:
 *
 * - Nao resolve DNS. Recebe endereco, devolve decisao. Quem resolve e o
 *   `guard`, que precisa validar **todos** os enderecos retornados
 * - Nao conhece URL, porta nem scheme
 * - Nao formata mensagem de erro. O motivo existe para log; a resposta ao
 *   usuario e uniforme (§2.8), e misturar as duas coisas aqui seria o caminho
 *   mais curto para vazar o motivo sem querer
 */

export type MotivoBloqueio =
  | 'LOOPBACK'
  | 'PRIVADO'
  | 'LINK_LOCAL'
  | 'METADADOS_CLOUD'
  | 'CGNAT'
  | 'RESERVADO'
  | 'MULTICAST'
  | 'BROADCAST'
  | 'IPV6_ULA'
  | 'IPV6_TRANSICAO'
  | 'ZONA_EXPLICITA'
  | 'NAO_E_IP';

export type DecisaoEgress =
  | { permitido: true; ip: string; familia: 4 | 6 }
  | { permitido: false; motivo: MotivoBloqueio; faixa: string };

interface FaixaV4 {
  readonly cidr: string;
  readonly base: number;
  readonly bits: number;
  readonly motivo: MotivoBloqueio;
}

function v4(cidr: string, motivo: MotivoBloqueio): FaixaV4 {
  const [rede, prefixo] = cidr.split('/');
  return { cidr, base: paraUint32(rede!)!, bits: Number(prefixo), motivo };
}

/**
 * Faixas IPv4 bloqueadas.
 *
 * `169.254.0.0/16` e a mais importante da lista: e onde vive o servico de
 * metadados das nuvens, e o alvo do ataque que o §1 da politica descreve.
 */
const FAIXAS_V4: readonly FaixaV4[] = [
  v4('0.0.0.0/8', 'RESERVADO'),
  v4('10.0.0.0/8', 'PRIVADO'),
  v4('100.64.0.0/10', 'CGNAT'),
  v4('127.0.0.0/8', 'LOOPBACK'),
  v4('169.254.0.0/16', 'METADADOS_CLOUD'),
  v4('172.16.0.0/12', 'PRIVADO'),
  v4('192.0.0.0/24', 'RESERVADO'),
  v4('192.0.2.0/24', 'RESERVADO'),
  v4('192.168.0.0/16', 'PRIVADO'),
  v4('198.18.0.0/15', 'RESERVADO'),
  v4('198.51.100.0/24', 'RESERVADO'),
  v4('203.0.113.0/24', 'RESERVADO'),
  v4('224.0.0.0/4', 'MULTICAST'),
  v4('240.0.0.0/4', 'RESERVADO'),
  v4('255.255.255.255/32', 'BROADCAST'),
]
  // Mais especifica primeiro, sempre.
  //
  // Sem esta ordenacao, `255.255.255.255` casa em `240.0.0.0/4` e e reportado
  // como RESERVADO em vez de BROADCAST. Nao muda a decisao — as duas bloqueiam
  // — mas envenena o log, que e o unico lugar onde o motivo sobrevive (§2.8).
  //
  // Ordenar aqui, e nao confiar na ordem em que alguem escreveu a lista, e o
  // que impede o proximo acrescimo de reintroduzir isso em silencio.
  .slice()
  .sort((a, b) => b.bits - a.bits);

/** Converte IPv4 pontilhado em inteiro sem sinal. Nulo se malformado. */
function paraUint32(endereco: string): number | null {
  const partes = endereco.split('.');
  if (partes.length !== 4) return null;

  let valor = 0;
  for (const parte of partes) {
    // Rejeita "01", "1e2", "+1", vazio — formas que alguns parsers aceitam e
    // interpretam diferente. Aqui so decimal simples entra.
    if (!/^\d{1,3}$/.test(parte)) return null;
    const octeto = Number(parte);
    if (octeto > 255) return null;
    valor = valor * 256 + octeto;
  }
  return valor >>> 0;
}

/** Expande IPv6 para 8 grupos de 16 bits. Nulo se malformado. */
function paraGrupos(endereco: string): number[] | null {
  const [antes, depois, ...resto] = endereco.split('::');
  if (resto.length > 0) return null;

  const ler = (trecho: string): number[] | null => {
    if (trecho === '') return [];
    const grupos: number[] = [];
    for (const g of trecho.split(':')) {
      // Ultimo grupo pode ser IPv4 pontilhado: ::ffff:127.0.0.1
      if (g.includes('.')) {
        const v = paraUint32(g);
        if (v === null) return null;
        grupos.push((v >>> 16) & 0xffff, v & 0xffff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      grupos.push(parseInt(g, 16));
    }
    return grupos;
  };

  const cabeca = ler(antes ?? '');
  if (cabeca === null) return null;

  if (depois === undefined) {
    return cabeca.length === 8 ? cabeca : null;
  }

  const cauda = ler(depois);
  if (cauda === null) return null;

  const faltando = 8 - cabeca.length - cauda.length;
  if (faltando < 0) return null;

  return [...cabeca, ...new Array<number>(faltando).fill(0), ...cauda];
}

function dentroV6(grupos: number[], prefixo: readonly number[], bits: number): boolean {
  let restantes = bits;
  for (let i = 0; i < 8 && restantes > 0; i++) {
    const largura = Math.min(16, restantes);
    const mascara = largura === 16 ? 0xffff : (0xffff << (16 - largura)) & 0xffff;
    if ((grupos[i]! & mascara) !== ((prefixo[i] ?? 0) & mascara)) return false;
    restantes -= largura;
  }
  return true;
}

/**
 * Extrai o IPv4 embutido, quando houver.
 *
 * **E a etapa que a v1 nao tinha, e a ausencia dela era metade dos contornos.**
 * `::ffff:127.0.0.1` e loopback escrito em IPv6: sem normalizar, ele escapa da
 * tabela IPv4 (por ser IPv6) e da tabela IPv6 (por nao estar em nenhuma faixa
 * IPv6 bloqueada). Fica no vao entre as duas.
 */
function ipv4Embutido(grupos: number[]): string | null {
  const mapeado = dentroV6(grupos, [0, 0, 0, 0, 0, 0xffff], 96);
  const compativel =
    dentroV6(grupos, [0, 0, 0, 0, 0, 0], 96) && (grupos[6]! !== 0 || grupos[7]! !== 0);

  if (!mapeado && !compativel) return null;

  const alto = grupos[6]!;
  const baixo = grupos[7]!;
  return [alto >>> 8, alto & 0xff, baixo >>> 8, baixo & 0xff].join('.');
}

function avaliarV4(endereco: string): DecisaoEgress {
  const valor = paraUint32(endereco);
  if (valor === null) return { permitido: false, motivo: 'NAO_E_IP', faixa: '-' };

  for (const faixa of FAIXAS_V4) {
    const mascara = faixa.bits === 0 ? 0 : (0xffffffff << (32 - faixa.bits)) >>> 0;
    if ((valor & mascara) >>> 0 === (faixa.base & mascara) >>> 0) {
      return { permitido: false, motivo: faixa.motivo, faixa: faixa.cidr };
    }
  }
  return { permitido: true, ip: endereco, familia: 4 };
}

/**
 * Decide sobre um endereco literal.
 *
 * Ordem deliberada: **normalizar antes de comparar**. Um endereco IPv6 que
 * carregue IPv4 e avaliado pela tabela IPv4, nao pela IPv6.
 */
export function avaliarEndereco(entrada: string): DecisaoEgress {
  // Identificador de zona (`fe80::1%eth0`) nomeia interface local. Nao existe
  // caso legitimo de site de cliente com zona, e o parser de URL nem sempre o
  // preserva — rejeitar e mais barato que raciocinar sobre cada caminho.
  if (entrada.includes('%')) {
    return { permitido: false, motivo: 'ZONA_EXPLICITA', faixa: '-' };
  }

  const familia = isIP(entrada);

  if (familia === 4) return avaliarV4(entrada);
  if (familia !== 6) return { permitido: false, motivo: 'NAO_E_IP', faixa: '-' };

  const grupos = paraGrupos(entrada);
  if (grupos === null) return { permitido: false, motivo: 'NAO_E_IP', faixa: '-' };

  const FAIXAS_V6: readonly {
    prefixo: readonly number[];
    bits: number;
    motivo: MotivoBloqueio;
    cidr: string;
  }[] = [
    { prefixo: [0, 0, 0, 0, 0, 0, 0, 1], bits: 128, motivo: 'LOOPBACK', cidr: '::1/128' },
    { prefixo: [0, 0, 0, 0, 0, 0, 0, 0], bits: 128, motivo: 'RESERVADO', cidr: '::/128' },
    // fc00::/7 e o equivalente IPv6 do RFC1918, e contem `fd00:ec2::254` — o
    // servico de metadados da AWS por IPv6. Estava ausente da v1.
    { prefixo: [0xfc00], bits: 7, motivo: 'IPV6_ULA', cidr: 'fc00::/7' },
    { prefixo: [0xfe80], bits: 10, motivo: 'LINK_LOCAL', cidr: 'fe80::/10' },
    // `fec0::/10` e site-local, obsoleto pela RFC 3879 e substituido pelo ULA.
    // **Nao esta na tabela do §2.1**, e passou numa sonda adversarial: sistemas
    // antigos ainda o roteiam, e "obsoleto" nao e o mesmo que "inalcancavel".
    // Custa uma linha bloquear e nao ha site de cliente aqui.
    { prefixo: [0xfec0], bits: 10, motivo: 'PRIVADO', cidr: 'fec0::/10' },
    // Analogos IPv6 de faixas que a tabela IPv4 ja bloqueia, e que faltavam
    // pelo mesmo motivo: a tabela foi escrita olhando IPv4 e traduzida em
    // parte.
    { prefixo: [0x2001, 0x0db8], bits: 32, motivo: 'RESERVADO', cidr: '2001:db8::/32' },
    { prefixo: [0x2001, 0x0002], bits: 48, motivo: 'RESERVADO', cidr: '2001:2::/48' },
    { prefixo: [0x0100], bits: 64, motivo: 'RESERVADO', cidr: '100::/64' },
    // NAT64 e 6to4 carregam IPv4 embutido em posicao diferente da mapeada.
    { prefixo: [0x0064, 0xff9b], bits: 32, motivo: 'IPV6_TRANSICAO', cidr: '64:ff9b::/96' },
    { prefixo: [0x2002], bits: 16, motivo: 'IPV6_TRANSICAO', cidr: '2002::/16' },
    { prefixo: [0xff00], bits: 8, motivo: 'MULTICAST', cidr: 'ff00::/8' },
  ];

  // As faixas IPv6 vem ANTES da extracao do IPv4 embutido, e a ordem custou um
  // bug: `::1` satisfaz a forma IPv4-compativel (`::0.0.0.1`), entao a extracao
  // o entregava como `0.0.0.1` e ele saia como RESERVADO em vez de LOOPBACK.
  //
  // Enderecos exatos e faixas proprias sao decididos primeiro; a normalizacao
  // atende so o que sobra.
  for (const faixa of [...FAIXAS_V6].sort((a, b) => b.bits - a.bits)) {
    if (dentroV6(grupos, faixa.prefixo, faixa.bits)) {
      return { permitido: false, motivo: faixa.motivo, faixa: faixa.cidr };
    }
  }

  const embutido = ipv4Embutido(grupos);
  if (embutido !== null) {
    const decisao = avaliarV4(embutido);
    // Mesmo que o IPv4 embutido seja publico, a forma nao e legitima para um
    // site de cliente. Deixar passar abriria um caminho que ninguem precisa.
    return decisao.permitido
      ? { permitido: false, motivo: 'IPV6_TRANSICAO', faixa: '::ffff:0:0/96' }
      : decisao;
  }

  return { permitido: true, ip: entrada, familia: 6 };
}
