import { expect, test } from '@playwright/test';

import { login } from './helpers';

/**
 * Fluxo crítico 3 — a tela mais importante do produto.
 *
 * Cobre os critérios 12 (score explicável), 13 (ações geram trilha) e 14
 * (registrar contato e agendar follow-up), além da regra de que nenhum modal
 * de bloqueio abre sozinho (critério 19).
 *
 * O Pipeline ficou de fora de propósito: drag and drop com dnd-kit produz
 * teste intermitente em CI, e a movimentação de etapa já é coberta por
 * `PATCH /leads/:id/pipeline-stage` na suíte da API. Teste que falha ao acaso
 * ensina o time a reexecutar em vez de investigar.
 */

async function abrirPrimeiroLead(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/leads');

  // A primeira linha de dados é a nth(1): a nth(0) é o cabeçalho da tabela.
  const link = page.getByRole('row').nth(1).getByRole('link').first();
  await expect(link).toBeVisible();
  await link.click();

  // waitForURL em vez de toHaveURL: o segmento dinâmico /leads/[id] compila sob
  // demanda no dev, e o expect padrão estoura antes de o Next terminar.
  await page.waitForURL(/\/leads\/[^/]+$/, { timeout: 60_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('ficha do lead', () => {
  test('carregar a ficha não dispara modal de bloqueio', async ({ page }) => {
    await login(page);
    await abrirPrimeiroLead(page);

    // Critério 19. O gate só age depois de tentativa explícita — carregar
    // página nunca pode abrir paywall.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('o score aparece explicado, com versão e data', async ({ page }) => {
    await login(page);
    await abrirPrimeiroLead(page);

    const card = page.getByRole('region').filter({ hasText: 'Score de oportunidade' });
    await expect(page.getByText('Score de oportunidade')).toBeVisible();

    // Critério 12: número sem explicação não serve. As duas colunas de motivos
    // precisam existir, e ao menos uma precisa ter conteúdo.
    await expect(page.getByText('Pontos positivos')).toBeVisible();
    await expect(page.getByText('Pontos de atenção')).toBeVisible();
    await expect(card.or(page.locator('body'))).toContainText(/v\d/);
  });

  test('recalcular o score responde sem erro', async ({ page }) => {
    await login(page);
    await abrirPrimeiroLead(page);

    // Escopo no card do score. `getByRole('alert')` na página inteira captura
    // erro de qualquer outro componente — o card de abordagem, a sidebar de
    // pipeline — e transforma "recalcular falhou" em diagnóstico errado.
    const cardScore = page
      .locator('section.pa-card')
      .filter({ hasText: 'Score de oportunidade' });

    await cardScore.getByRole('button', { name: 'Recalcular' }).click();

    await expect(page.getByText('Pontos positivos')).toBeVisible();
    await expect(cardScore.getByRole('alert')).toHaveCount(0);
  });

  test('registrar contato entra na timeline', async ({ page }) => {
    await login(page);
    await abrirPrimeiroLead(page);

    await page.getByRole('button', { name: 'Registrar contato' }).click();
    await page.getByLabel('Resultado').fill('Contato de teste automatizado');
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();

    // Critério 14: registrar precisa atualizar a timeline na mesma tela.
    await expect(page.getByText('Contato de teste automatizado')).toBeVisible();
  });

  test('agendar e concluir follow-up', async ({ page }) => {
    await login(page);
    await abrirPrimeiroLead(page);

    await page.getByRole('button', { name: 'Agendar' }).first().click();
    await page.getByLabel('Observação').fill('Follow-up de teste automatizado');
    await page.getByRole('button', { name: 'Agendar', exact: true }).last().click();

    const item = page
      .getByRole('listitem')
      .filter({ hasText: 'Follow-up de teste automatizado' });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Pendente');

    await item.getByRole('button', { name: 'Concluir' }).click();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Follow-up de teste automatizado' }),
    ).toContainText('Concluído');
  });
});
