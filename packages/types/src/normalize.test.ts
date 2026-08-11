import { describe, expect, it } from 'vitest';

import {
  buildSearchKeyword,
  classifyWebsite,
  fingerprintInput,
  normalizeBusinessName,
  toE164,
  toE164BR,
  toRegion,
  toStateUf,
  whatsappStatusFromPhone,
} from './normalize';

/**
 * Caminho internacional — acrescentado em 06/08/2026.
 *
 * Antes disso, lead estrangeiro perdia região e telefone em silêncio: as
 * funções devolviam `null` para tudo fora do Brasil, sem erro e sem sinal.
 * Perda silenciosa é a pior falha num produto de dados, porque ninguém
 * percebe até alguém conferir à mão.
 */
describe('normalização fora do Brasil', () => {
  it('mantém o nome da região quando o país não é o Brasil', () => {
    // Preferir o nome bruto a `null` é decisão consciente: dado imperfeito
    // com procedência é utilizável, ausência não é.
    expect(toRegion('Lombardia', 'IT')).toBe('Lombardia');
    expect(toRegion('Bayern', 'DE')).toBe('Bayern');
    expect(toRegion('Greater London', 'GB')).toBe('Greater London');
  });

  it('continua convertendo para sigla no Brasil', () => {
    expect(toRegion('São Paulo', 'BR')).toBe('SP');
    // Sem país declarado, presume Brasil — compatibilidade com o que existia.
    expect(toRegion('São Paulo')).toBe('SP');
  });

  it('não inventa código de país em telefone estrangeiro', () => {
    // Inferir prefixo a partir de número local produz telefone plausível e
    // errado. Alguém liga, e liga para a pessoa errada.
    expect(toE164('02 1234 5678', 'IT')).toBeNull();
    expect(toE164('(020) 7946 0958', 'GB')).toBeNull();
  });

  it('aceita telefone estrangeiro que já vem internacional', () => {
    expect(toE164('+39 02 1234 5678', 'IT')).toBe('+390212345678');
    expect(toE164('+44 20 7946 0958', 'GB')).toBe('+442079460958');
  });

  it('recusa número fora da faixa do padrão E.164', () => {
    expect(toE164('+1234567', 'US')).toBeNull();
    expect(toE164(`+${'9'.repeat(16)}`, 'US')).toBeNull();
  });

  it('nunca afirma WhatsApp provável fora do Brasil', () => {
    // Regra 5.2 do escopo: sinal só vira afirmação depois de verificação que
    // aconteceu. Cada país tem sua regra de numeração móvel, e chutar seria
    // palpite disfarçado de dado.
    expect(whatsappStatusFromPhone('+39 340 123 4567', 'IT')).toBe('UNKNOWN');
    expect(whatsappStatusFromPhone('+44 7700 900123', 'GB')).toBe('UNKNOWN');
  });

  it('mantém a regra brasileira intacta', () => {
    expect(whatsappStatusFromPhone('(11) 98765-4321')).toBe('LIKELY');
    expect(whatsappStatusFromPhone('(11) 3456-7890')).toBe('UNKNOWN');
  });
});

describe('toStateUf', () => {
  it('converte nome por extenso em sigla', () => {
    // O scraper devolve o estado por extenso. Sem esta conversão o filtro
    // por estado simplesmente não encontra nada.
    expect(toStateUf('São Paulo')).toBe('SP');
    expect(toStateUf('Rio de Janeiro')).toBe('RJ');
    expect(toStateUf('Minas Gerais')).toBe('MG');
  });

  it('aceita sigla que já vem pronta', () => {
    expect(toStateUf('SP')).toBe('SP');
    expect(toStateUf('rj')).toBe('RJ');
  });

  it('lida com o prefixo que aparece quando a coleta roda em inglês', () => {
    expect(toStateUf('State of São Paulo')).toBe('SP');
    expect(toStateUf('Estado de Minas Gerais')).toBe('MG');
  });

  it('ignora acentuação', () => {
    expect(toStateUf('Sao Paulo')).toBe('SP');
    expect(toStateUf('Ceara')).toBe('CE');
  });

  it('devolve null quando não reconhece', () => {
    expect(toStateUf('Califórnia')).toBeNull();
    expect(toStateUf('')).toBeNull();
    expect(toStateUf(null)).toBeNull();
  });
});

describe('toE164BR', () => {
  it('normaliza celular e fixo', () => {
    expect(toE164BR('(11) 99755-1555')).toBe('+5511997551555');
    expect(toE164BR('(11) 3255-1000')).toBe('+551132551000');
  });

  it('remove o código do país quando já vem junto', () => {
    expect(toE164BR('+55 11 99755-1555')).toBe('+5511997551555');
  });

  it('rejeita número com quantidade de dígitos inválida', () => {
    expect(toE164BR('1234')).toBeNull();
    expect(toE164BR('(11) 9999')).toBeNull();
  });

  it('rejeita DDD impossível', () => {
    expect(toE164BR('(01) 99999-9999')).toBeNull();
  });
});

describe('whatsappStatusFromPhone', () => {
  it('marca celular como provável, nunca como confirmado', () => {
    // O produto não verifica WhatsApp. LIKELY é o máximo que dá para
    // afirmar — daí o rótulo "WhatsApp provável" na interface.
    expect(whatsappStatusFromPhone('(11) 99755-1555')).toBe('LIKELY');
  });

  it('trata fixo como desconhecido, não como ausente', () => {
    expect(whatsappStatusFromPhone('(11) 3255-1000')).toBe('UNKNOWN');
  });

  it('trata número inválido ou vazio como desconhecido', () => {
    expect(whatsappStatusFromPhone(null)).toBe('UNKNOWN');
    expect(whatsappStatusFromPhone('abc')).toBe('UNKNOWN');
  });
});

describe('classifyWebsite', () => {
  it('reconhece construtores gratuitos como site precário', () => {
    expect(classifyWebsite('https://vianna-smile.base44.app/').status).toBe(
      'SITE_PRECARIO',
    );
    expect(classifyWebsite('https://empresa.wixsite.com/inicio').status).toBe(
      'SITE_PRECARIO',
    );
    expect(classifyWebsite('https://linktr.ee/empresa').status).toBe('SITE_PRECARIO');
  });

  it('reconhece rede social usada como site', () => {
    expect(classifyWebsite('https://instagram.com/empresa').status).toBe(
      'SITE_PRECARIO',
    );
  });

  it('reconhece domínio próprio', () => {
    expect(classifyWebsite('https://empresa.com.br').status).toBe('SITE_PROPRIO');
  });

  it('detecta ausência de HTTPS', () => {
    expect(classifyWebsite('http://empresa.com.br').hasHttps).toBe(false);
    expect(classifyWebsite('https://empresa.com.br').hasHttps).toBe(true);
  });

  it('trata campo vazio como sem site', () => {
    expect(classifyWebsite(null).status).toBe('SEM_SITE');
    expect(classifyWebsite('').status).toBe('SEM_SITE');
    expect(classifyWebsite('   ').status).toBe('SEM_SITE');
  });

  it('trata URL malformada como desconhecido, não como ausente', () => {
    // URL quebrada não é prova de que o negócio não tem site.
    expect(classifyWebsite('h ttp://:::').status).toBe('DESCONHECIDO');
  });

  it('não confunde subdomínio parecido com domínio precário', () => {
    expect(classifyWebsite('https://naowixsite.com.br').status).toBe('SITE_PROPRIO');
  });
});

describe('normalizeBusinessName', () => {
  it('remove acento, pontuação e sufixo societário', () => {
    expect(normalizeBusinessName('Clínica Odontológica Ltda.')).toBe(
      'clinica odontologica',
    );
    expect(normalizeBusinessName('Estética & Beleza ME')).toBe('estetica beleza');
  });

  it('faz nomes equivalentes convergirem', () => {
    expect(normalizeBusinessName('Café São João LTDA')).toBe(
      normalizeBusinessName('Cafe Sao Joao'),
    );
  });
});

describe('fingerprintInput', () => {
  it('produz a mesma entrada para dados equivalentes', () => {
    // Worker e seed precisam gerar fingerprint idêntico, senão a
    // deduplicação não deduplica e o cliente paga por lead repetido.
    const a = fingerprintInput('Clínica Odontológica Ltda', '+5511999999999', '01001-000');
    const b = fingerprintInput('Clinica Odontologica', '+5511999999999', '01001000');

    expect(a).toBe(b);
  });

  it('distingue empresas diferentes', () => {
    const a = fingerprintInput('Clínica A', '+5511999999999', '01001-000');
    const b = fingerprintInput('Clínica B', '+5511999999999', '01001-000');

    expect(a).not.toBe(b);
  });
});

describe('buildSearchKeyword', () => {
  it('monta a consulta com e sem bairro', () => {
    expect(
      buildSearchKeyword({ niche: 'Dentistas', city: 'São Paulo', stateUf: 'SP' }),
    ).toBe('Dentistas em São Paulo, SP');

    expect(
      buildSearchKeyword({
        niche: 'Dentistas',
        city: 'São Paulo',
        stateUf: 'SP',
        neighborhood: 'Vila Mariana',
      }),
    ).toBe('Dentistas em Vila Mariana, São Paulo, SP');
  });
});
