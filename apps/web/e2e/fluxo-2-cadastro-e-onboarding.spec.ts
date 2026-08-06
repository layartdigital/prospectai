import { expect, test } from '@playwright/test';

import { aguardarHidratacao, kpiValue, login, runId } from './helpers';

/**
 * Fluxo crítico 2 — conta nova.
 *
 * Cobre os critérios 4 (cadastro), 6 (onboarding persiste e é reiniciável) e o
 * isolamento entre tenants visto pela interface: a conta recém-criada não pode
 * enxergar um único lead do workspace de demonstração.
 *
 * Este é o teste que substitui o "passo 5" manual.
 */

const conta = {
  nome: 'Pessoa de Teste',
  workspace: `Workspace E2E ${runId}`,
  email: `e2e-${runId}@teste.propectai.local`,
  senha: 'SenhaDeTeste123',
};

test.describe.configure({ mode: 'serial' });

test.describe('cadastro, onboarding e isolamento', () => {
  test('cadastro cria conta e leva ao onboarding, não ao dashboard', async ({ page }) => {
    await page.goto('/register');
    await aguardarHidratacao(page, 'Criar conta');

    await page.getByLabel('Seu nome').fill(conta.nome);
    await page.getByLabel('Nome do workspace').fill(conta.workspace);
    await page.getByLabel('E-mail').fill(conta.email);
    await page.getByLabel('Senha').fill(conta.senha);
    await page.getByRole('button', { name: 'Criar conta' }).click();

    // Dashboard de tenant sem nenhum lead é a pior primeira tela possível.
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText('Etapa 1 de 5')).toBeVisible();
  });

  test('o onboarding retoma onde parou', async ({ page }) => {
    await login(page, { email: conta.email, password: conta.senha });

    await page.goto('/onboarding');

    // Avança duas etapas escolhendo o que dá para verificar depois.
    await page.getByRole('button', { name: 'Sites' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Etapa 2 de 5')).toBeVisible();

    await page.getByPlaceholder('Restaurantes, clínicas').fill('Clínicas');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Etapa 3 de 5')).toBeVisible();

    // Sai da tela como quem fecha a aba, e volta.
    await page.goto('/dashboard');
    await page.goto('/onboarding');

    // A persistência é por etapa: o que foi respondido continua lá. Onboarding
    // que perde resposta é onboarding abandonado na segunda tentativa.
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByText('Etapa 3 de 5')).toBeVisible();
  });

  test('conta nova não enxerga nada do workspace de demonstração', async ({ page }) => {
    await login(page, { email: conta.email, password: conta.senha });

    await page.goto('/leads');

    // O seed tem 25 leads em outro tenant. Qualquer linha aqui é vazamento.
    await expect(page.getByText(/nenhum lead/i)).toBeVisible();

    await page.goto('/dashboard');
    // Exatamente "0", não "contém 0": o workspace de demonstração tem 26, e
    // `toContainText('0')` passaria alegremente com "20" na tela.
    await expect(kpiValue(page, 'Leads encontrados')).toHaveText('0');
  });

  test('Configurações permite refazer o onboarding', async ({ page }) => {
    await login(page, { email: conta.email, password: conta.senha });

    await page.goto('/settings');

    await page.getByRole('button', { name: /onboarding/i }).click();
    await expect(page).toHaveURL(/\/onboarding/);

    // Refazer não apaga resposta: "Sites" continua selecionado da etapa 1.
    await expect(page.getByRole('button', { name: 'Sites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
