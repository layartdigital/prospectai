import { describe, expect, it } from 'vitest';

import { avaliarEndereco } from '../src/egress/ip-ranges';

/**
 * Cada bloco "contorno N" corresponde a um furo real encontrado em revisao da
 * `SECURITY-EGRESS-POLICY`. Sao regressoes, nao exemplos: se um deles voltar a
 * passar, a falha e a mesma que ja aconteceu.
 */

const bloqueado = (ip: string) => {
  const d = avaliarEndereco(ip);
  return d.permitido ? `PERMITIDO (deveria bloquear)` : d.motivo;
};

describe('faixas IPv4', () => {
  it('bloqueia loopback, privadas e CGNAT', () => {
    expect(bloqueado('127.0.0.1')).toBe('LOOPBACK');
    expect(bloqueado('127.255.255.254')).toBe('LOOPBACK');
    expect(bloqueado('10.0.0.1')).toBe('PRIVADO');
    expect(bloqueado('172.16.0.1')).toBe('PRIVADO');
    expect(bloqueado('172.31.255.255')).toBe('PRIVADO');
    expect(bloqueado('192.168.1.1')).toBe('PRIVADO');
    expect(bloqueado('100.64.0.1')).toBe('CGNAT');
  });

  it('bloqueia o servico de metadados de nuvem', () => {
    expect(bloqueado('169.254.169.254')).toBe('METADADOS_CLOUD');
  });

  it('permite endereco publico', () => {
    const d = avaliarEndereco('8.8.8.8');
    expect(d.permitido).toBe(true);
    expect(avaliarEndereco('172.32.0.1').permitido).toBe(true); // fora do /12
    expect(avaliarEndereco('100.128.0.1').permitido).toBe(true); // fora do /10
  });

  it('rejeita octeto com zero a esquerda', () => {
    // "010.0.0.1" e 8.0.0.1 em octal para alguns parsers, 10.0.0.1 para outros.
    // Ambiguidade nao entra: recusa.
    expect(bloqueado('010.0.0.1')).toBe('NAO_E_IP');
  });
});

describe('contorno 1 — IPv6 ULA fc00::/7', () => {
  it('bloqueia o IMDS da AWS por IPv6', () => {
    expect(bloqueado('fd00:ec2::254')).toBe('IPV6_ULA');
  });

  it('bloqueia os dois extremos da faixa', () => {
    expect(bloqueado('fc00::1')).toBe('IPV6_ULA');
    expect(bloqueado('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe('IPV6_ULA');
  });

  it('nao bloqueia o vizinho fe00::', () => {
    expect(avaliarEndereco('fe00::1').permitido).toBe(true);
  });
});

describe('contorno 2 — IPv4-mapped', () => {
  it('bloqueia loopback escrito como IPv6', () => {
    expect(bloqueado('::ffff:127.0.0.1')).toBe('LOOPBACK');
  });

  it('bloqueia na forma hexadecimal, sem pontos', () => {
    expect(bloqueado('::ffff:7f00:1')).toBe('LOOPBACK');
  });

  it('bloqueia metadados mapeado', () => {
    expect(bloqueado('::ffff:169.254.169.254')).toBe('METADADOS_CLOUD');
  });

  it('recusa mesmo quando o IPv4 embutido e publico', () => {
    // Nao ha caso legitimo de site de cliente nesta forma.
    expect(bloqueado('::ffff:8.8.8.8')).toBe('IPV6_TRANSICAO');
  });
});

describe('contorno 3 — NAT64 e 6to4', () => {
  it('bloqueia NAT64 carregando metadados', () => {
    expect(bloqueado('64:ff9b::a9fe:a9fe')).toBe('IPV6_TRANSICAO');
  });

  it('bloqueia 6to4', () => {
    expect(bloqueado('2002:a9fe:a9fe::1')).toBe('IPV6_TRANSICAO');
  });
});

describe('identificador de zona', () => {
  it('recusa link-local com interface', () => {
    expect(bloqueado('fe80::1%eth0')).toBe('ZONA_EXPLICITA');
  });
  it('recusa a forma percent-encoded', () => {
    expect(bloqueado('fe80::1%25eth0')).toBe('ZONA_EXPLICITA');
  });
});

describe('IPv6 geral', () => {
  it('bloqueia loopback, nao especificado, link-local e multicast', () => {
    expect(bloqueado('::1')).toBe('LOOPBACK');
    expect(bloqueado('::')).toBe('RESERVADO');
    expect(bloqueado('fe80::1')).toBe('LINK_LOCAL');
    expect(bloqueado('ff02::1')).toBe('MULTICAST');
  });

  it('permite endereco publico', () => {
    expect(avaliarEndereco('2606:4700:4700::1111').permitido).toBe(true);
  });

  it('trata forma comprimida e expandida igual', () => {
    expect(bloqueado('fd00:0000:0000:0000:0000:0000:0000:0001')).toBe('IPV6_ULA');
    expect(bloqueado('fd00::1')).toBe('IPV6_ULA');
  });
});

describe('faixas que a tabela da politica nao listava', () => {
  // Encontradas por sonda adversarial depois de os testes acima passarem.
  // Geraram o erratum E11 na `SECURITY-EGRESS-POLICY-v3.md` §2.1.
  it('bloqueia site-local obsoleto (RFC 3879)', () => {
    expect(bloqueado('fec0::1')).toBe('PRIVADO');
  });

  it('bloqueia os analogos IPv6 das faixas reservadas', () => {
    expect(bloqueado('2001:db8::1')).toBe('RESERVADO'); // documentacao
    expect(bloqueado('2001:2::1')).toBe('RESERVADO');   // benchmark
    expect(bloqueado('100::1')).toBe('RESERVADO');      // discard-only
  });

  it('nao bloqueia o vizinho de baixo do link-local', () => {
    expect(avaliarEndereco('fe7f::1').permitido).toBe(true);
  });
});

describe('ordem das faixas', () => {
  // Os dois casos abaixo falharam na primeira execucao, por ordem de lista.
  it('reporta broadcast, nao a faixa reservada que o contem', () => {
    expect(bloqueado('255.255.255.255')).toBe('BROADCAST');
  });

  it('reporta ::1 como loopback, nao como IPv4-compativel', () => {
    // `::1` satisfaz a forma `::a.b.c.d`. Sem decidir faixa antes de
    // normalizar, ele saia como RESERVADO por virar `0.0.0.1`.
    expect(bloqueado('::1')).toBe('LOOPBACK');
    expect(bloqueado('::0.0.0.1')).toBe('LOOPBACK');
  });
});

describe('entrada invalida', () => {
  it('recusa o que nao e endereco', () => {
    for (const lixo of ['', 'localhost', 'exemplo.com.br', '1.2.3', '1.2.3.4.5', '999.1.1.1', 'gggg::1']) {
      expect(bloqueado(lixo)).toBe('NAO_E_IP');
    }
  });

  it('recusa formas alternativas de escrever loopback', () => {
    // Decimal, octal e hexadecimal sao recusados como literal. Se algum
    // resolvedor os aceitar como nome, a validacao pos-DNS pega o IP real —
    // e esta e a razao de a politica validar depois da resolucao, nao antes.
    for (const forma of ['2130706433', '0177.0.0.1', '0x7f.0.0.1', '127.1', '127.0.0.1.']) {
      expect(bloqueado(forma)).toBe('NAO_E_IP');
    }
  });
});
