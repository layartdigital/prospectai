import { expect, test } from '@playwright/test';

import { clientApiUrl } from '../src/lib/client-api-url';

/**
 * Transporte same-origin — GATE_NET Fase 2A, 07/10/2026.
 *
 * Estes testes existem porque o CI não cobre este caminho: ele roda tipos e a
 * suíte unitária, não constrói a web e não executa Playwright. A prova de que
 * o navegador alcança a API por caminho relativo só existe aqui e na inspeção
 * do bundle.
 *
 * Também cobrem o matcher do middleware. Testar a expressão regular pelo texto
 * provaria que a string é a string; o que importa é o efeito — `/api` chega na
 * API e `/dashboard` continua protegido.
 */
test.describe('transporte same-origin', () => {
  test('clientApiUrl devolve caminho relativo, sem host nem porta', () => {
    expect(clientApiUrl('/auth/login')).toBe('/api/v1/auth/login');
    expect(clientApiUrl('auth/login')).toBe('/api/v1/auth/login');
    expect(clientApiUrl('/leads/export?x=1')).toBe('/api/v1/leads/export?x=1');

    for (const rota of ['/auth/login', 'auth/login', '/leads/export?x=1', '/']) {
      const url = clientApiUrl(rota);
      expect(url.startsWith('/api/v1')).toBe(true);
      expect(url).not.toContain('http://');
      expect(url).not.toContain('https://');
      expect(url).not.toContain('3101');
      expect(url).not.toContain('3102');
    }
  });

  test('POST /api/v1/auth/login chega na API, e nao no middleware', async ({
    request,
  }) => {
    // Corpo vazio de propósito: a resposta esperada é a validação do DTO (400).
    // Um 307 aqui significaria middleware interceptando; HTML, Next respondendo.
    const response = await request.post('/api/v1/auth/login', {
      data: {},
      maxRedirects: 0,
    });

    expect(response.status()).toBe(400);
    expect(response.headers()['content-type'] ?? '').toContain('application/json');
  });

  test('GET /api/v1/health responde a API, e nao a web', async ({ request }) => {
    const response = await request.get('/api/v1/health', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] ?? '').toContain('application/json');
  });

  test('rota protegida continua sob o middleware', async ({ request }) => {
    const response = await request.get('/dashboard', { maxRedirects: 0 });

    expect([302, 307, 308]).toContain(response.status());
    expect(response.headers()['location'] ?? '').toContain('/login');
  });

  test('/login continua publico', async ({ request }) => {
    const response = await request.get('/login', { maxRedirects: 0 });

    expect(response.status()).toBe(200);
  });
});
