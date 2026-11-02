import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  abrirExplorer,
  armarVigiaDeVazamento,
  baseURL,
  botaoDeRelacao,
  carregarRelacao,
  desligarPollingLongo,
  entrarComo,
  evidencia,
  grafoPelaApi,
  houveVazamento,
  manifesto,
  PADRAO_DE_DADOS_DO_ALFA,
  refLead,
  refsDoGrafo,
  refsDoTipo,
  selecionarNo,
  trocarCookieDeSessaoPara,
  voltarParaAAba,
  type GrafoDaApi,
  type Quem,
  type SinalDeRetorno,
} from './explorer-support';

/**
 * E2E-06 (isolamento Alfa x Beta) e E2E-07 (mudanca de sessao entre abas).
 *
 * Cada teste usa contextos de navegador novos (cookies proprios). Os dois
 * workspaces sao reais: Alfa e o tenant de demonstracao, Beta e outro tenant
 * com outro usuario, criado pelas fixtures. Nao ha autenticacao ficticia: todo
 * login passa pela API real e pelo hash argon2 real.
 */

test.describe.configure({ mode: 'serial' });

async function novoContexto(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
  });
}

async function abaLogada(browser: Browser, quem: Quem): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await novoContexto(browser);
  const page = await contexto.newPage();
  await entrarComo(page, quem);
  return { contexto, page };
}

const DADOS_DO_ALFA = PADRAO_DE_DADOS_DO_ALFA;
const DADOS_DO_BETA = /Beta (Exclusiva|Usuario|Workspace)|Nota E2E Beta/;

test.describe('E2E-06 isolamento entre workspaces', () => {
  test('E2E-06a: o Beta so enxerga o Beta — busca, grafo, expansoes e URLs diretas', async ({ browser }) => {
    const m = manifesto();
    const { contexto, page } = await abaLogada(browser, 'beta');
    try {
      await page.goto('/intelligence');

      // Busca: so leads do Beta.
      await expect(page.getByRole('button', { name: new RegExp(m.beta.hub.name) })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(m.beta.segundo.name) })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(DADOS_DO_ALFA);

      await page.getByPlaceholder('Nome da empresa').fill('Alfa');
      await expect(page.getByText('Nenhum lead encontrado com estes filtros.')).toBeVisible();
      await page.getByPlaceholder('Nome da empresa').fill('');

      // Grafo do Beta: a pesquisa tem 2 leads, os dois do Beta; 3 notas, todas do Beta.
      await page.getByRole('button', { name: new RegExp(m.beta.hub.name) }).click();
      await expect(page.locator(`svg [data-no="${refLead(m.beta.hub.id)}"]`)).toBeVisible();

      await carregarRelacao(page, 'Nota');
      await expect(page.locator('svg [data-no^="NOTE:"]')).toHaveCount(m.beta.notas);

      const pesquisa = refsDoTipo(await refsDoGrafo(page), 'SEARCH')[0] ?? '';
      await selecionarNo(page, pesquisa);
      await carregarRelacao(page, 'Lead');
      const leads = refsDoTipo(await refsDoGrafo(page), 'LEAD').sort();
      expect(leads).toEqual([refLead(m.beta.hub.id), refLead(m.beta.segundo.id)].sort());

      await expect(page.locator('body')).not.toContainText(DADOS_DO_ALFA);
      await evidencia(page, 'e2e-06-grafo-do-beta');

      // URL direta com o id de um lead do Alfa: 404 do servidor, mensagem neutra, nada do Alfa na tela.
      await page.goto(`/intelligence?lead=${m.alfa.hub.id}`);
      const alerta = page.getByRole('alert').filter({ hasText: 'Não foi possível montar o grafo' });
      await expect(alerta).toBeVisible();
      await expect(alerta).toContainText('Não encontrado neste workspace');
      await expect(page.locator('svg [data-no]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(DADOS_DO_ALFA);

      // API: 404 (nunca 403, que confirmaria a existencia) e corpo sem dado do Alfa.
      const api = await grafoPelaApi(page, m.alfa.hub.id);
      expect(api.status).toBe(404);
      expect(api.corpo).not.toMatch(DADOS_DO_ALFA);

      // Ficha do lead do Alfa dentro da sessao do Beta: nao existe.
      await page.goto(`/leads/${m.alfa.hub.id}`);
      await expect(page.getByText(/404|could not be found|não encontrad/i).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText(DADOS_DO_ALFA);

      // Lista de leads do Beta nao traz nada do Alfa.
      await page.goto('/leads?search=Alfa');
      await expect(page.locator('body')).not.toContainText(DADOS_DO_ALFA);
    } finally {
      await contexto.close();
    }
  });

  test('E2E-06b: o Alfa so enxerga o Alfa — e nada do Beta', async ({ browser }) => {
    const m = manifesto();
    const { contexto, page } = await abaLogada(browser, 'alfa');
    try {
      await page.goto('/intelligence');
      await page.getByPlaceholder('Nome da empresa').fill('Beta Exclusiva');
      await expect(page.getByText('Nenhum lead encontrado com estes filtros.')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(DADOS_DO_BETA);

      await page.goto(`/intelligence?lead=${m.beta.hub.id}`);
      const alerta = page.getByRole('alert').filter({ hasText: 'Não foi possível montar o grafo' });
      await expect(alerta).toBeVisible();
      await expect(alerta).toContainText('Não encontrado neste workspace');
      await expect(page.locator('svg [data-no]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(DADOS_DO_BETA);

      const api = await grafoPelaApi(page, m.beta.hub.id);
      expect(api.status).toBe(404);
      expect(api.corpo).not.toMatch(DADOS_DO_BETA);

      await page.goto(`/leads/${m.beta.hub.id}`);
      await expect(page.getByText(/404|could not be found|não encontrad/i).first()).toBeVisible();

      await page.goto('/leads?search=Beta');
      await expect(page.locator('body')).not.toContainText(DADOS_DO_BETA);
    } finally {
      await contexto.close();
    }
  });

  test('E2E-06c: prova de profundidade do Alfa nao funciona na sessao do Beta (replay entre workspaces)', async ({ browser }) => {
    const m = manifesto();
    const alfa = await abaLogada(browser, 'alfa');
    const beta = await abaLogada(browser, 'beta');
    try {
      const g = JSON.parse((await grafoPelaApi(alfa.page, m.alfa.hub.id)).corpo) as GrafoDaApi;
      const raizAlfa = g.nodes.find((n) => n.ref === refLead(m.alfa.hub.id));
      expect(raizAlfa?.depthProof).toBeTruthy();

      // Controle positivo: no Alfa, a prova vale.
      const consulta = (ref: string, prova: string): string =>
        `/api/v1/intelligence/expand?ref=${encodeURIComponent(ref)}&kind=NOTE&parentDepth=0` +
        `&parentDepthProof=${encodeURIComponent(prova)}`;
      const noAlfa = await alfa.page.request.get(consulta(refLead(m.alfa.hub.id), raizAlfa?.depthProof ?? ''));
      expect(noAlfa.status()).toBe(200);

      // Replay no Beta: a assinatura amarra o workspace, entao e recusada — e nada do Alfa volta.
      const replay = await beta.page.request.get(consulta(refLead(m.alfa.hub.id), raizAlfa?.depthProof ?? ''));
      expect(replay.status()).toBe(400);
      expect(await replay.text()).not.toMatch(DADOS_DO_ALFA);

      // Prova inventada.
      const inventada = await beta.page.request.get(consulta(refLead(m.alfa.hub.id), 'AAAAAAAAAAAAAAAAAAAAAA'));
      expect(inventada.status()).toBe(400);
      expect(await inventada.text()).not.toMatch(DADOS_DO_ALFA);

      // Controle positivo do Beta, com a prova do proprio Beta.
      const gb = JSON.parse((await grafoPelaApi(beta.page, m.beta.hub.id)).corpo) as GrafoDaApi;
      const raizBeta = gb.nodes.find((n) => n.ref === refLead(m.beta.hub.id));
      const noBeta = await beta.page.request.get(consulta(refLead(m.beta.hub.id), raizBeta?.depthProof ?? ''));
      expect(noBeta.status()).toBe(200);
    } finally {
      await alfa.contexto.close();
      await beta.contexto.close();
    }
  });

  test('E2E-06d: duas janelas ao mesmo tempo, cada uma com o seu workspace, sem mistura', async ({ browser }) => {
    const m = manifesto();
    const alfa = await abaLogada(browser, 'alfa');
    const beta = await abaLogada(browser, 'beta');
    try {
      await Promise.all([abrirExplorer(alfa.page, m.alfa.hub.id), abrirExplorer(beta.page, m.beta.hub.id)]);
      await Promise.all([carregarRelacao(alfa.page, 'Nota'), carregarRelacao(beta.page, 'Nota')]);

      await expect(alfa.page.locator('svg [data-no^="NOTE:"]')).toHaveCount(8);
      await expect(beta.page.locator('svg [data-no^="NOTE:"]')).toHaveCount(m.beta.notas);

      const refsAlfa = new Set(await refsDoGrafo(alfa.page));
      const refsBeta = await refsDoGrafo(beta.page);
      for (const r of refsBeta) expect(refsAlfa.has(r), `${r} nao pode existir nos dois workspaces`).toBe(false);

      await expect(alfa.page.locator('body')).not.toContainText(DADOS_DO_BETA);
      await expect(beta.page.locator('body')).not.toContainText(DADOS_DO_ALFA);
    } finally {
      await alfa.contexto.close();
      await beta.contexto.close();
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Prepara a "aba A" (Explorer do hub do Alfa, com 8 notas na tela) e a "aba B"
 * (dashboard) no MESMO contexto — mesmos cookies, como duas abas do mesmo
 * navegador. O relogio de 20 s do vigia e removido da aba A: so eventos mudam a
 * tela, nunca o polling.
 */
async function duasAbas(browser: Browser): Promise<{ contexto: BrowserContext; abaA: Page; abaB: Page }> {
  const m = manifesto();
  const contexto = await novoContexto(browser);
  const abaA = await contexto.newPage();
  await desligarPollingLongo(abaA);
  await entrarComo(abaA, 'alfa');
  await abrirExplorer(abaA, m.alfa.hub.id);
  await carregarRelacao(abaA, 'Nota');
  await expect(abaA.locator('svg [data-no^="NOTE:"]')).toHaveCount(8);

  const abaB = await contexto.newPage();
  await abaB.goto('/dashboard');
  await expect(abaB).toHaveURL(/\/dashboard/);
  return { contexto, abaA, abaB };
}

/** A aba A nao tem mais nenhum dado do Alfa, nem no grafo nem em texto. */
async function esperarDescarteNaAbaA(abaA: Page): Promise<void> {
  await expect(abaA.locator('svg [data-no]')).toHaveCount(0);
  await expect(abaA.locator('body')).not.toContainText(DADOS_DO_ALFA);
  await expect(abaA.getByRole('region', { name: 'Detalhes da entidade' }).getByRole('heading', { level: 2, name: manifesto().alfa.hub.name })).toHaveCount(0);
}

test.describe('E2E-07 mudanca de sessao em outra aba', () => {
  test('E2E-07a: logout na aba B descarta o Explorer da aba A na hora (sem polling)', async ({ browser }) => {
    const { contexto, abaA, abaB } = await duasAbas(browser);
    try {
      await abaB.getByRole('button', { name: 'Sair' }).click();
      await abaB.waitForURL(/\/login/, { timeout: 60_000 });

      await esperarDescarteNaAbaA(abaA);
      await expect(
        abaA.getByTestId('explorer-sessao-mudou').or(abaA.getByRole('button', { name: 'Entrar' })),
      ).toBeVisible({ timeout: 30_000 });
      await expect(abaA.locator('body')).not.toContainText(DADOS_DO_ALFA);
    } finally {
      await contexto.close();
    }
  });

  test('E2E-07b: login de outro workspace na aba B descarta a aba A; ela so volta com dados do Beta', async ({ browser }) => {
    const m = manifesto();
    const { contexto, abaA, abaB } = await duasAbas(browser);
    try {
      await entrarComo(abaB, 'beta');

      await esperarDescarteNaAbaA(abaA);
      await expect(abaA.getByText('Nenhum lead selecionado')).toBeVisible({ timeout: 30_000 });
      // A tela renovada mostra o workspace novo: leads do Beta, nada do Alfa.
      await expect(abaA.getByRole('button', { name: new RegExp(m.beta.hub.name) })).toBeVisible();
      await expect(abaA.locator('body')).not.toContainText(DADOS_DO_ALFA);
      await evidencia(abaA, 'e2e-07-aba-a-depois-da-troca-para-beta');
    } finally {
      await contexto.close();
    }
  });

  test('E2E-07c: outro USUARIO no mesmo workspace tambem descarta a aba A', async ({ browser }) => {
    const { contexto, abaA, abaB } = await duasAbas(browser);
    try {
      await entrarComo(abaB, 'sdr');

      await esperarDescarteNaAbaA(abaA);
      await expect(abaA.getByText('Nenhum lead selecionado')).toBeVisible({ timeout: 30_000 });
    } finally {
      await contexto.close();
    }
  });

  for (const evento of ['focus', 'visibilitychange', 'pageshow', 'online'] as SinalDeRetorno[]) {
    test(`E2E-07d: troca silenciosa de cookie + evento "${evento}" descarta a aba A (sem polling, sem anuncio)`, async ({ browser }) => {
      const { contexto, abaA } = await duasAbas(browser);
      try {
        // Cookie trocado por baixo da aba A, sem nenhum anuncio entre abas.
        await trocarCookieDeSessaoPara(abaA, 'beta');
        // Antes do evento, a aba A ainda nao sabe de nada: ainda mostra o Alfa.
        await expect(abaA.locator('svg [data-no^="NOTE:"]')).toHaveCount(8);

        await voltarParaAAba(abaA, evento);

        await esperarDescarteNaAbaA(abaA);
        await expect(abaA.getByText('Nenhum lead selecionado')).toBeVisible({ timeout: 30_000 });
      } finally {
        await contexto.close();
      }
    });
  }

  test('E2E-07e: resposta pendente que chega depois da troca nao repovoa a tela', async ({ browser }) => {
    const { contexto, abaA } = await duasAbas(browser);
    try {
      const mais = botaoDeRelacao(abaA, 'Atividade');
      await expect(mais).toBeEnabled();

      let liberar: () => void = () => undefined;
      const portao = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      let interceptada: () => void = () => undefined;
      const aviso = new Promise<void>((resolve) => {
        interceptada = resolve;
      });

      // A resposta e REAL (a API responde com a sessao do Alfa, vigente neste instante);
      // so e entregue ao navegador depois da troca de sessao.
      await abaA.route('**/api/v1/intelligence/expand**', async (route) => {
        const real = await route.fetch();
        interceptada();
        await portao;
        // Se a tela ja abortou o pedido, nao ha mais rota a cumprir: nao e falha do teste.
        await route.fulfill({ response: real }).catch(() => undefined);
      });

      let desfecho: 'pendente' | 'entregue' | 'abortada' = 'pendente';
      abaA.on('requestfinished', (r) => {
        if (r.url().includes('/api/v1/intelligence/expand')) desfecho = 'entregue';
      });
      abaA.on('requestfailed', (r) => {
        if (r.url().includes('/api/v1/intelligence/expand')) desfecho = 'abortada';
      });

      await mais.click();
      await aviso;

      // Troca de sessao com o pedido ainda no ar.
      await trocarCookieDeSessaoPara(abaA, 'beta');
      await voltarParaAAba(abaA, 'focus');
      await esperarDescarteNaAbaA(abaA);
      await expect(abaA.getByText('Nenhum lead selecionado')).toBeVisible({ timeout: 30_000 });

      // Daqui em diante, qualquer dado do Alfa que apareca e vazamento.
      await armarVigiaDeVazamento(abaA);
      liberar();
      await expect.poll(() => desfecho, { message: 'a resposta atrasada foi entregue ou abortada' }).not.toBe('pendente');

      // Dois quadros de renderizacao para qualquer atualizacao tardia se manifestar.
      await abaA.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

      expect(await houveVazamento(abaA), 'nenhum dado do Alfa reapareceu').toBe(false);
      await expect(abaA.locator('svg [data-no]')).toHaveCount(0);
      await expect(abaA.locator('body')).not.toContainText(DADOS_DO_ALFA);
    } finally {
      await contexto.close();
    }
  });
});
