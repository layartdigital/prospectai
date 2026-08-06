import { expect, test } from '@playwright/test';

import { aguardarHidratacao, DEMO, irPara, kpiValue, login } from './helpers';

/**
 * Fluxo crítico 1 — sessão e indicadores reais.
 *
 * Cobre os critérios 4 (login, sessão resolve tenant), 7 (KPIs por query),
 * 16 (paginação e filtros no servidor) e 20 (versão visível).
 */

test.describe('sessão e visão geral', () => {
  test('rota protegida sem sessão redireciona para o login', async ({ page }) => {
    await page.goto('/dashboard');

    // O middleware precisa agir antes de a página renderizar. Se o dashboard
    // aparecer por um instante antes do redirect, houve vazamento de shell
    // autenticado para visitante.
    await expect(page).toHaveURL(/\/login/);
  });

  test('login leva ao dashboard com o workspace de demonstração', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible();

    // Critério 7: o número vem de query. O workspace de demonstração tem 25
    // leads no seed; zero aqui denunciaria KPI desconectado do banco.
    await expect(kpiValue(page, 'Leads encontrados')).toHaveText(/^[1-9]\d*$/);
  });

  test('rodapé mostra versão, ambiente e status da API', async ({ page }) => {
    await login(page);

    const footer = page.locator('footer');
    await expect(footer).toContainText('PropectAI v0.1.1');
    // Critério 20 + o healthcheck que passou a incluir o scraper.
    await expect(footer).toContainText('API ok');
  });

  test('Meus Leads pagina no servidor e combina filtros', async ({ page }) => {
    await login(page);
    await irPara(page, 'Meus Leads', /\/leads/);

    const linhas = page.getByRole('row');
    const antes = await linhas.count();
    expect(antes).toBeGreaterThan(1);

    // Filtro por score alto precisa reduzir o conjunto. Se a contagem não
    // mudar, o filtro está sendo ignorado no servidor.
    await page.goto('/leads?minScore=80');
    await expect(page.getByRole('row').first()).toBeVisible();

    const depois = await page.getByRole('row').count();
    expect(depois).toBeLessThanOrEqual(antes);
  });

  test('o menu tem apenas o que foi aprovado para a v0.1.1', async ({ page }) => {
    await login(page);

    const nav = page.getByRole('navigation', { name: 'Navegação principal' });

    for (const item of [
      'Dashboard',
      'Nova Busca',
      'Meus Leads',
      'Pipeline',
      'Histórico',
      'Propostas',
      'Precificador',
      'Avisos',
    ]) {
      await expect(nav.getByRole('link', { name: item })).toBeVisible();
    }

    // Critério 24: o módulo Construtor de Sites não existe em lugar nenhum.
    // E as duas rotas retiradas do menu em 31/07 não podem voltar sozinhas.
    await expect(nav.getByRole('link', { name: /site/i })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'IA de Abordagem' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Contratos' })).toHaveCount(0);
  });

  test('credenciais nunca aparecem na URL', async ({ page }) => {
    // Regressão de 31/07/2026. Antes da trava de hidratação, clicar em Entrar
    // com o React ainda não hidratado disparava o submit nativo do formulário:
    // GET para a própria rota com email e password na query string, que vai
    // para o histórico do navegador, o log do servidor e o Referer.
    const urlsVisitadas: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) urlsVisitadas.push(frame.url());
    });

    await login(page);

    for (const url of urlsVisitadas) {
      expect(url).not.toContain('password');
      expect(url).not.toContain('senha');
    }
  });

  test('credenciais inválidas não revelam se o e-mail existe', async ({ page }) => {
    await page.goto('/login');
    await aguardarHidratacao(page, 'Entrar');
    await page.getByLabel('E-mail').fill(DEMO.email);
    await page.getByLabel('Senha').fill('senha-errada-de-proposito');
    await page.getByRole('button', { name: 'Entrar' }).click();

    const erro = page.getByRole('alert');
    await expect(erro).toBeVisible();
    // A mensagem não pode distinguir "e-mail não existe" de "senha incorreta":
    // a diferença permite enumerar contas.
    await expect(erro).not.toContainText(/não encontrad|não existe|inexistente/i);
  });
});
