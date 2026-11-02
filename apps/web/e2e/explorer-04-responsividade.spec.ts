import { expect, test } from '@playwright/test';

import {
  abrirExplorer,
  entrarComo,
  evidencia,
  manifesto,
  no,
  painelDetalhes,
  refLead,
  selecionarNo,
} from './explorer-support';

/**
 * E2E-08 — responsividade do Explorer em 1440, 820 e 390 pixels de largura.
 *
 * O criterio e o de uso, nao o de pixel: sem rolagem horizontal da pagina, as
 * tres areas (busca, grafo, detalhes) existem e cabem na largura, o grafo tem
 * area util, e os controles de zoom continuam alcancaveis e com alvo de toque
 * de pelo menos 32 px.
 */

const TELAS = [
  { nome: 'desktop-1440', largura: 1440, altura: 900 },
  { nome: 'tablet-820', largura: 820, altura: 1180 },
  { nome: 'celular-390', largura: 390, altura: 844 },
] as const;

test.describe.configure({ mode: 'serial' });

for (const tela of TELAS) {
  test(`E2E-08: Explorer em ${tela.largura}px de largura`, async ({ page }) => {
    const m = manifesto();
    await page.setViewportSize({ width: tela.largura, height: tela.altura });
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    // 1) Nada estoura a largura da janela.
    const medidas = await page.evaluate(() => ({
      janela: document.documentElement.clientWidth,
      conteudo: document.documentElement.scrollWidth,
    }));
    expect(medidas.conteudo, 'sem rolagem horizontal da pagina').toBeLessThanOrEqual(medidas.janela + 1);

    // 2) As tres areas existem e cabem na largura.
    const busca = page.getByRole('region', { name: 'Buscar lead' });
    const detalhes = painelDetalhes(page);
    const canvas = page.getByRole('group', { name: /^Grafo de relações/ });
    for (const area of [busca, canvas, detalhes]) {
      await area.scrollIntoViewIfNeeded();
      await expect(area).toBeVisible();
      const caixa = await area.boundingBox();
      expect(caixa).not.toBeNull();
      expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(tela.largura + 1);
      expect(caixa?.x ?? 0).toBeGreaterThanOrEqual(-1);
    }

    // 3) O grafo tem area util.
    const area = await canvas.boundingBox();
    expect(area?.width ?? 0).toBeGreaterThan(Math.min(280, tela.largura - 40));
    expect(area?.height ?? 0).toBeGreaterThan(300);

    // 4) Controles de zoom visiveis e com alvo de toque razoavel.
    for (const rotulo of ['Aproximar', 'Afastar', 'Enquadrar tudo']) {
      const botao = page.getByRole('button', { name: rotulo });
      await botao.scrollIntoViewIfNeeded();
      await expect(botao).toBeVisible();
      const caixa = await botao.boundingBox();
      expect(caixa?.width ?? 0).toBeGreaterThanOrEqual(32);
      expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(32);
    }

    // 5) Selecionar a raiz mostra o nome no painel de detalhes, legivel e dentro da largura.
    await selecionarNo(page, refLead(m.alfa.hub.id));
    const titulo = detalhes.getByRole('heading', { level: 2, name: m.alfa.hub.name });
    await titulo.scrollIntoViewIfNeeded();
    await expect(titulo).toBeVisible();
    const caixaTitulo = await titulo.boundingBox();
    expect((caixaTitulo?.x ?? 0) + (caixaTitulo?.width ?? 0)).toBeLessThanOrEqual(tela.largura + 1);

    // 6) Raiz continua ligada ao DOM e o grafo continua interativo depois do redimensionamento.
    await page.setViewportSize({ width: tela.largura, height: tela.altura - 100 });
    await expect(no(page, refLead(m.alfa.hub.id))).toBeAttached();

    await page.evaluate(() => window.scrollTo(0, 0));
    await evidencia(page, `e2e-08-explorer-${tela.nome}`);
  });
}

test('E2E-08b: o botao "Explorar relacoes" da ficha cabe em 390px', async ({ page }) => {
  const m = manifesto();
  await page.setViewportSize({ width: 390, height: 844 });
  await entrarComo(page, 'alfa');
  await page.goto(`/leads/${m.alfa.hub.id}`);

  const botao = page.getByRole('link', { name: 'Explorar relações' });
  await botao.scrollIntoViewIfNeeded();
  await expect(botao).toBeVisible();
  const caixa = await botao.boundingBox();
  expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThanOrEqual(391);
  expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(24);

  await evidencia(page, 'e2e-08-ficha-celular-390');
});
