import { describe, expect, it } from 'vitest';

import { validarUrl, type EnderecoResolvido, type Resolvedor } from '../src/egress/guard';

/**
 * Casos S1 a S15 de F0 — `SECURITY-EGRESS-POLICY-v3.md` §9.
 *
 * **Um `it()` por caso, e nao um bloco unico.** A primeira versao deste arquivo
 * colapsava os 28 numa assercao so: a primeira falha abortava as demais, e o
 * relatorio dizia "1 test" onde havia 28. Suite que esconde o que cobre e
 * parente do healthcheck que grita falso.
 *
 * **O resolvedor e injetado, com custo declarado.** A politica avisa que teste
 * de rebinding contra resolvedor falso passa trivialmente. Estes casos provam
 * a LOGICA — que resposta com IP privado e recusada, que todos os enderecos
 * sao avaliados, que a ordem das checagens e a prevista. Provar a REDE exige
 * resolucao real, e fica no checklist do primeiro deploy.
 */

const fixo = (...ips: string[]): Resolvedor => () =>
  Promise.resolve(
    ips.map((address): EnderecoResolvido => ({
      address,
      family: address.includes(':') ? 6 : 4,
    })),
  );

const explode: Resolvedor = () => Promise.reject(new Error('SERVFAIL'));
const vazio: Resolvedor = () => Promise.resolve([]);
const publico = fixo('93.184.216.34');

async function esperar(url: string, r: Resolvedor, esperado: string): Promise<void> {
  const d = await validarUrl(url, r);
  expect(d.permitido ? `OK:${d.ip}:${d.porta}` : d.motivo).toBe(esperado);
}

describe('egress guard', () => {
  // S1 na porta 80. Ver E12: com :5434 a recusa vem da porta, e a tabela de
  // faixas nunca e consultada — o teste passaria sem provar o que promete.
  it('S1 loopback :80', async () => {
    await esperar('http://127.0.0.1/', publico, 'LOOPBACK');
  });

  it('S1 loopback nome', async () => {
    await esperar('http://db.interno/', fixo('127.0.0.1'), 'LOOPBACK');
  });

  it('E12 porta recusa antes', async () => {
    await esperar('http://127.0.0.1:5434/', publico, 'PORTA_PROIBIDA');
  });

  it('S2 metadados', async () => {
    await esperar('http://169.254.169.254/latest/', publico, 'METADADOS_CLOUD');
  });

  it('S2b IMDS IPv6', async () => {
    await esperar('http://[fd00:ec2::254]/', publico, 'IPV6_ULA');
  });

  it('S2c mapped', async () => {
    await esperar('http://[::ffff:127.0.0.1]/', publico, 'LOOPBACK');
  });

  it('S2d NAT64', async () => {
    await esperar('http://[64:ff9b::a9fe:a9fe]/', publico, 'IPV6_TRANSICAO');
  });

  it('S3 nome resolve para privado', async () => {
    await esperar('http://interno.exemplo/', fixo('10.0.0.5'), 'PRIVADO');
  });

  it('S3b publico + privado', async () => {
    await esperar('http://misto.exemplo/', fixo('93.184.216.34','127.0.0.1'), 'LOOPBACK');
  });

  it('S3b ordem invertida', async () => {
    await esperar('http://misto.exemplo/', fixo('127.0.0.1','93.184.216.34'), 'LOOPBACK');
  });

  it('S5 FQDN ponto final', async () => {
    await esperar('http://postgres./', explode, 'DNS_FALHOU');
  });

  it('S7 file://', async () => {
    await esperar('file:///etc/passwd', publico, 'SCHEME_PROIBIDO');
  });

  it('S7 gopher://', async () => {
    await esperar('gopher://exemplo/', publico, 'SCHEME_PROIBIDO');
  });

  it('S7 dict://', async () => {
    await esperar('dict://exemplo/', publico, 'SCHEME_PROIBIDO');
  });

  it('S7b porta isolada 6381', async () => {
    await esperar('http://exemplo.com.br:6381/', publico, 'PORTA_PROIBIDA');
  });

  it('S7b porta 5434', async () => {
    await esperar('http://exemplo.com.br:5434/', publico, 'PORTA_PROIBIDA');
  });

  it('S15 credencial na URL', async () => {
    await esperar('http://user:token@exemplo.com.br/', publico, 'CREDENCIAL_NA_URL');
  });

  it('feliz http', async () => {
    await esperar('http://exemplo.com.br/x', publico, 'OK:93.184.216.34:80');
  });

  it('feliz https', async () => {
    await esperar('https://exemplo.com.br/', publico, 'OK:93.184.216.34:443');
  });

  it('feliz porta explicita', async () => {
    await esperar('https://exemplo.com.br:443/', publico, 'OK:93.184.216.34:443');
  });

  it('feliz IPv6 publico', async () => {
    await esperar('http://[2606:4700:4700::1111]/', publico, 'OK:2606:4700:4700::1111:80');
  });

  it('feliz literal publico', async () => {
    await esperar('http://93.184.216.34/', publico, 'OK:93.184.216.34:80');
  });

  it('DNS vazio', async () => {
    await esperar('http://exemplo.com.br/', vazio, 'DNS_SEM_RESPOSTA');
  });

  it('DNS falhou', async () => {
    await esperar('http://exemplo.com.br/', explode, 'DNS_FALHOU');
  });

  it('URL malformada', async () => {
    await esperar('nao e url', publico, 'URL_MALFORMADA');
  });

  // `http:///x` NAO e malformada: o Node le a barra tripla como host `caminho`.
  it('barra tripla vira host', async () => {
    await esperar('http:///caminho', publico, 'OK:93.184.216.34:80');
  });

  it('IDN vira punycode', async () => {
    await esperar('http://пример.рф/', publico, 'OK:93.184.216.34:80');
  });

  it('maiuscula normaliza', async () => {
    await esperar('http://EXEMPLO.com.BR/', publico, 'OK:93.184.216.34:80');
  });
});
