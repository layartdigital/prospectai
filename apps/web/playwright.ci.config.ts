import { defineConfig, devices } from '@playwright/test';

/**
 * Configuracao do E2E em CI (P04-QA-04, revisada na P04-QA-04R).
 *
 * Difere de `playwright.config.ts` em tres pontos, todos de infraestrutura:
 *
 *  1. **Nao sobe servidor.** O job do CI inicia API, Next (build de producao) e
 *     o gateway por conta propria, espera cada um responder e guarda o log de
 *     cada processo. Se o Playwright subisse o stack (`webServer`), uma falha de
 *     inicializacao viraria "timeout do webServer" sem log da causa.
 *  2. **Sem `trace` nem video.** O trace do Playwright grava cookies e o corpo
 *     das requisicoes — incluindo o POST de login com a senha.
 *  3. **Saida BRUTA fora do que e publicado** (`E2E_RESULTS_DIR`). No CI esse
 *     diretorio fica em `$RUNNER_TEMP`, fora do workspace: o JSON, o relatorio
 *     HTML (que embute os dados dos testes comprimidos, portanto inverificaveis
 *     por varredura de texto) e os anexos de falha nunca entram no artefato. O
 *     que se publica e a saida montada por `e2e/ci/sanitizar-resultados.mjs`
 *     (lista permitida de campos) mais as capturas sinteticas que as specs
 *     gravam em `E2E_EVIDENCE_DIR`.
 *
 * Tudo o mais (timeouts, serial, locale, fuso, viewport) e igual ao da config
 * local, para que o que passa aqui seja o mesmo teste que roda na maquina de
 * quem desenvolve.
 */
const resultados = process.env.E2E_RESULTS_DIR ?? 'test-results-ci';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',

  workers: 1,
  fullyParallel: false,

  // Sem retry: teste que so passa na segunda tentativa e teste intermitente, e
  // o gate nao pode esconder isso. `forbidOnly` impede um `.only` esquecido.
  retries: 0,
  forbidOnly: true,

  timeout: 90_000,
  expect: { timeout: 20_000 },

  outputDir: `${resultados}/artefatos`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${resultados}/resultado.json` }],
    ['html', { open: 'never', outputFolder: `${resultados}/relatorio-html` }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    // Captura de falha mostra a tela da aplicacao; campos de senha saem mascarados.
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
