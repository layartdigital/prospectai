import { defineConfig, devices } from '@playwright/test';

/**
 * E2E dos fluxos críticos — previsto no escopo §4.3 para a v0.1.1.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',

  /**
   * Sobe o que faltar, reaproveita o que já estiver no ar.
   *
   * `reuseExistingServer` faz o Playwright checar a URL antes de executar o
   * comando: com `pnpm dev` rodando, nada é iniciado; sem ele, a suíte se vira
   * sozinha.
   *
   * Dois blocos em vez de um `pnpm dev` na raiz porque os processos caem
   * separados — API viva e web morta foi o estado real que produziu
   * ERR_CONNECTION_REFUSED em 31/07/2026, e um comando único tentaria religar
   * a API, colidindo na porta 3101.
   *
   * O worker fica de fora: nenhum destes testes dispara coleta.
   */
  webServer: [
    {
      command: 'pnpm --filter @propectai/api dev',
      url: 'http://localhost:3101/api/v1/health',
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @propectai/web dev',
      url: 'http://localhost:3100/login',
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],

  // Serial: os testes escrevem no mesmo banco de demonstração. Paralelizar
  // criaria interferência entre eles com cara de bug de produto.
  workers: 1,
  fullyParallel: false,

  // Folga grande de propósito. Mesmo com o aquecimento, o Next em dev recompila
  // ao detectar mudança e o Prisma inicializa o engine sob demanda. Timeout
  // curto aqui não deixa o teste mais rigoroso — só troca "falhou" por
  // "falhou por motivo errado", que custa uma investigação inteira.
  timeout: 90_000,
  expect: { timeout: 20_000 },

  // HTML além do list: `playwright show-report` só funciona se o relatório for
  // gerado, e é ele que dá o trace navegável quando algo falha.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Rastro só do que falhou: artefato de teste verde é lixo que ninguém abre.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});