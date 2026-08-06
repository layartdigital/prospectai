import { describe, expect, it } from 'vitest';

import {
  buildSearchKeyword,
  classifyWebsite,
  fingerprintInput,
  normalizeBusinessName,
  toE164BR,
  toStateUf,
  whatsappStatusFromPhone,
} from './normalize';

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
