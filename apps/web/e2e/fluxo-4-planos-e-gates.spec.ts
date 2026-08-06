import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DEMO, login } from './helpers';

/**
 * Fluxo crítico 4 — feature gates nos quatro planos (critério 19).
 *
 * Duas afirmações independentes, e as duas precisam valer:
 *
 *   1. Nenhum modal de bloqueio abre ao carregar página. Em nenhum plano, em
 *      nenhuma tela.
 *   2. O gate muda de comportamento entre os planos. Um produto onde tudo
 *      passa em qualquer plano também satisfaz a afirmação 1 — e está errado.
 *
 * A segunda existe porque a primeira, sozinha, é fácil de passar por acidente.
 *
 * Nota de arquitetura: o produto não tem `role="dialog"` em lugar nenhum. O
 * bloqueio é um bloco contextualizado onde o resultado apareceria, com link
 * para os planos — ver comentário em `lead-outreach-card.tsx`. A asserção de
 * ausência de modal é portanto uma trava de regressão contra alguém introduzir
 * um: barata de manter, e protege a regra que o escopo chama de razão de
 * existir do produto.
 *
 * Precisa de `pnpm db:seed` — só age em tenants com `isDemo: true`.
 */

const RAIZ = path.resolve(__dirname, '../../..');

type Plano = 'free' | 'start' | 'pro' | 'agency';

/** Troca o plano do tenant de demonstração pelo mesmo CLI que a pessoa usa. */
function trocarPlano(plano: Plano): void {
  execFileSync('pnpm', ['db:plan', plano, '--reset'], {
    cwd: RAIZ,
    stdio: 'pipe',
    // Windows precisa de shell para resolver o pnpm.cmd do PATH.
    shell: true,
  });
}

/** Telas que qualquer plano pode abrir. Nenhuma delas pode disparar modal. */
const TELAS = ['/dashboard', '/leads', '/pipeline', '/search', '/history', '/settings'];

async function abrirPrimeiroLead(page: Page): Promise<void> {
  await page.goto('/leads');
  const link = page.getByRole('row').nth(1).getByRole('link').first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/leads\/[^/]+$/, { timeout: 60_000 });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  // Devolve o ambiente ao estado do seed. Teste que deixa o banco num plano
  // diferente do inicial faz o próximo desenvolvedor perseguir um fantasma.
  trocarPlano('free');
});

for (const plano of ['free', 'start', 'pro', 'agency'] as const) {
  test.describe(`plano ${plano.toUpperCase()}`, () => {
    test('nenhuma tela dispara modal de bloqueio ao carregar', async ({ page }) => {
      trocarPlano(plano);
      // Login novo a cada plano: a sessão carrega o plano vigente, e reaproveitar
      // a anterior testaria o plano errado.
      await login(page);

      for (const tela of TELAS) {
        await page.goto(tela);
        await expect(
          page.getByRole('dialog'),
          `${tela} abriu modal sem ação do usuário no plano ${plano}`,
        ).toHaveCount(0);
      }

      await abrirPrimeiroLead(page);
      await expect(
        page.getByRole('dialog'),
        `a ficha do lead abriu modal sem ação do usuário no plano ${plano}`,
      ).toHaveCount(0);
    });
  });
}

test.describe('o gate muda entre os planos', () => {
  test('FREE mascara o telefone; PRO não', async ({ page }) => {
    trocarPlano('free');
    await login(page);
    await page.goto('/leads');

    // Aviso informativo, não bloqueio: explica o que está oculto e por quê.
    // Aparecer ao carregar é correto — o que não pode é interromper.
    await expect(page.getByText(/parcialmente ocultos/i)).toBeVisible();

    trocarPlano('pro');
    await login(page);
    await page.goto('/leads');

    await expect(page.getByText(/parcialmente ocultos/i)).toHaveCount(0);
  });

  test('no FREE o bloqueio da IA só aparece depois do clique', async ({ page }) => {
    trocarPlano('free');
    await login(page);
    await abrirPrimeiroLead(page);

    // FREE tem aiGenerationsPerMonth: 0. Mesmo assim o card aparece
    // contextualizado, e nada bloqueia até a pessoa tentar.
    const verPlanos = page.getByRole('link', { name: 'Ver planos' });
    await expect(verPlanos).toHaveCount(0);

    await page.getByRole('button', { name: /Gerar abordagem|Regenerar/ }).click();

    // Agora sim: bloqueio no lugar do resultado, com caminho para o upgrade.
    await expect(verPlanos.first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('no AGENCY a mesma ação gera em vez de bloquear', async ({ page }) => {
    trocarPlano('agency');
    await login(page);
    await abrirPrimeiroLead(page);

    await page.getByRole('button', { name: /Gerar abordagem|Regenerar/ }).click();

    // O contraponto do teste anterior: sem ele, "bloqueou" e "quebrou"
    // produzem o mesmo resultado visível.
    await expect(page.getByLabel(/Mensagem gerada/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Ver planos' })).toHaveCount(0);
  });
});

test.describe('exportação por plano', () => {
  test('FREE não exporta; PRO exporta', async ({ page }) => {
    trocarPlano('free');
    await login(page);
    await page.goto('/leads');

    // O botão pode existir e bloquear na tentativa, ou não existir. As duas
    // formas são aceitáveis — o que não vale é exportar num plano sem direito.
    const exportarFree = page.getByRole('button', { name: /exportar/i });
    if (await exportarFree.count()) {
      await exportarFree.first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText(/plano|upgrade|Ver planos/i).first()).toBeVisible();
    }

    trocarPlano('pro');
    await login(page);
    await page.goto('/leads');

    const exportarPro = page.getByRole('button', { name: /exportar/i });
    if (await exportarPro.count()) {
      const download = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await exportarPro.first().click();
      expect(
        await download,
        'PRO tem CSV no plano e a exportação não produziu download',
      ).not.toBeNull();
    }
  });
});
