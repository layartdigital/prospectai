const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3199';
const out = [];
const PAINEL = '[data-tour="explorer-details"]';
const ok = (nome, cond, extra = '') => { out.push(`${cond ? 'PASS' : 'FAIL'} ${nome}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  // 1. estado vazio
  await page.goto(BASE + '/');
  await page.getByText('Nenhum lead selecionado').waitFor();
  await page.waitForSelector('text=Clínica Sorriso Campinas');
  await page.screenshot({ path: 'shots/01-estado-vazio.png' });
  ok('estado vazio verdadeiro (sem lead selecionado, sem grafo)', await page.locator('svg [data-no]').count() === 0);

  // 2. escolher o lead -> grafo inicial
  await page.getByRole('button', { name: /Clínica Sorriso Campinas/ }).click();
  await page.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
  await page.waitForTimeout(400);
  const nosIniciais = await page.locator('svg [data-no]').count();
  ok('grafo inicial tem 5 nos (lead, pesquisa, score, presenca, cartao)', nosIniciais === 5, `nos=${nosIniciais}`);
  ok('URL passou a carregar ?lead=', page.url().includes('?lead=lead_alfa_0000001'));
  ok('raiz selecionada e painel mostra o lead', await page.getByRole('heading', { name: 'Clínica Sorriso Campinas', level: 2 }).count() > 0);
  ok('telefone aparece mascarado no painel', await page.getByText('(19) ••••••-1234').count() > 0);
  await page.screenshot({ path: 'shots/02-grafo-inicial.png' });

  // 3. selecionar Score e carregar motivos
  await page.locator('[data-no^="SCORE:"]').click();
  await page.waitForTimeout(150);
  ok('painel muda para o Score', await page.getByText('Versão do algoritmo').count() > 0);
  ok('conexao mostra proveniencia (FK) e selo Vínculo no cadastro', (await page.getByText('Origem: lead_scores.leadId → leads.id').count()) > 0 && (await page.getByText('Vínculo no cadastro', { exact: true }).count()) > 0);
  await page.locator(PAINEL).getByRole('button', { name: /^Motivo do score/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg [data-no^="SCORE_REASON:"]').length === 5);
  ok('expandir motivos traz 5 nos', true);

  // 4. presenca -> sinais (DESCONHECIDO em cinza)
  await page.locator('[data-no^="PRESENCE:"]').click();
  await page.locator(PAINEL).getByRole('button', { name: /^Sinal/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg [data-no^="SIGNAL:"]').length === 7);
  ok('expandir sinais traz 7 nos', true);
  // lead -> notas (8 de 30), depois mais 8
  await page.locator('[data-no^="LEAD:lead_alfa_0000001"]').click();
  await page.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg [data-no^="NOTE:"]').length === 8);
  await page.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg [data-no^="NOTE:"]').length === 16);
  ok('paginacao de notas: 8 e depois 16 (sem duplicar)', true);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Ajustar|Enquadrar tudo/ }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/03-grafo-expandido.png' });

  // sinal desconhecido: selecionar Instagram
  await page.locator('[data-no^="SIGNAL:"]').filter({ hasText: 'Instagram' }).click();
  ok('sinal Instagram e Desconhecido, com a explicacao de que nao e ausencia', (await page.getByText('Desconhecido').count()) > 0 && (await page.getByText('Isso não significa', { exact: false }).count() + await page.getByText('não significa que o sinal não exista', { exact: false }).count()) > 0);
  await page.screenshot({ path: 'shots/04-sinal-desconhecido.png' });

  // 5. filtro por tipo
  const antes = await page.locator('svg [data-no]').count();
  await page.getByLabel(/^Nota\s*\d/).uncheck();
  await page.waitForTimeout(200);
  const depois = await page.locator('svg [data-no]').count();
  ok('desmarcar "Nota" oculta os 16 nos de nota', antes - depois === 16, `${antes} -> ${depois}`);
  await page.getByLabel(/^Nota\s*\d/).check();
  await page.waitForTimeout(200);

  // 6. zoom e pan
  const pct = async () => Number((await page.locator('text=/^\\d+%$/').first().innerText()).replace('%', ''));
  const z0 = await pct();
  await page.locator('[data-tour="explorer-canvas"]').hover();
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);
  const z1 = await pct();
  ok('roda do mouse aproxima', z1 > z0, `${z0}% -> ${z1}%`);
  await page.getByRole('button', { name: 'Afastar' }).click();
  ok('botao Afastar reduz o zoom', (await pct()) < z1);
  const g = page.locator('svg[role="group"] > g').first();
  const t0 = await g.getAttribute('transform');
  await page.mouse.move(700, 700); await page.mouse.down(); await page.mouse.move(760, 740, { steps: 5 }); await page.mouse.up();
  const t1 = await g.getAttribute('transform');
  ok('arrastar o fundo faz pan', t0 !== t1);

  // 7. teclado
  await page.locator('svg[role="group"]').focus();
  const t2 = await g.getAttribute('transform');
  await page.keyboard.press('ArrowRight');
  ok('seta move a vista', (await g.getAttribute('transform')) !== t2);
  await page.keyboard.press('0');
  await page.locator('[data-no^="PIPELINE_CARD:"]').focus();
  await page.keyboard.press('Enter');
  ok('Enter em no focado seleciona', await page.getByText('Cartão no pipeline', { exact: false }).count() > 0);
  await page.keyboard.press('Escape');

  // 8. limite de profundidade: etapa a partir do cartao
  await page.locator('[data-no^="PIPELINE_CARD:"]').click();
  await page.locator(PAINEL).getByRole('button', { name: /^Etapa comercial/ }).click();
  await page.waitForSelector('[data-no^="PIPELINE_STAGE:"]');
  ok('cartao -> etapa comercial', true);

  // 9. pesquisa -> leads da pesquisa
  await page.locator('[data-no^="SEARCH:"]').click();
  await page.locator(PAINEL).getByRole('button', { name: /^Lead\s*\(/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg [data-no^="LEAD:"]').length === 4);
  ok('pesquisa expande para 4 leads do proprio tenant (sem o intruso do Beta)', true);
  const textoPagina = await page.locator('body').innerText();
  ok('nenhum texto do Beta na tela do Alfa', !/Intruso|Beta Fit|Lead do Beta/.test(textoPagina));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/05-pesquisa-expandida.png' });

  // 10. recentrar em outro lead
  await page.locator('[data-no="LEAD:lead_alfa_0000002"]').click();
  await page.getByRole('button', { name: /Explorar a partir deste lead/ }).click();
  await page.waitForFunction(() => location.search.includes('lead_alfa_0000002'));
  await page.waitForSelector('[data-no="LEAD:lead_alfa_0000002"]');
  ok('recentrar troca a raiz e a URL', true);
  await page.screenshot({ path: 'shots/06-outro-lead.png' });

  // 11. erro: lead inexistente
  await page.goto(BASE + '/?lead=lead_inexistente_9');
  await page.getByText('Não foi possível montar o grafo').waitFor();
  ok('lead inexistente mostra estado de erro com mensagem clara', await page.getByText('Não encontrado neste workspace').count() > 0);
  await page.screenshot({ path: 'shots/07-erro-nao-encontrado.png' });

  // 12. isolamento visivel: Beta abre lead do Alfa
  const ctxB = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctxB.addCookies([{ name: 'as', value: 'beta', url: BASE }]);
  const pb = await ctxB.newPage();
  await pb.goto(BASE + '/?lead=lead_alfa_0000001');
  await pb.getByText('Não foi possível montar o grafo').waitFor();
  const corpoBeta = await pb.locator('body').innerText();
  ok('Beta abrindo lead do Alfa recebe o mesmo erro, sem nenhum dado do Alfa', !/Sorriso|Campinas|Alfa/.test(corpoBeta));
  await pb.screenshot({ path: 'shots/08-beta-lead-do-alfa.png' });
  await pb.goto(BASE + '/?lead=lead_beta_00000001');
  await pb.waitForSelector('[data-no="LEAD:lead_beta_00000001"]');
  ok('Beta ve o proprio grafo', (await pb.locator('svg [data-no]').count()) === 2);
  await pb.screenshot({ path: 'shots/09-beta-proprio-grafo.png' });

  // 13. responsivo
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pm = await ctxM.newPage();
  await pm.goto(BASE + '/?lead=lead_alfa_0000001');
  await pm.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
  await pm.waitForTimeout(500);
  const rolagemH = await pm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('390px: sem scroll horizontal', rolagemH <= 0, `overflow=${rolagemH}px`);
  await pm.screenshot({ path: 'shots/10-mobile-390.png', fullPage: true });
  const ctxT = await browser.newContext({ viewport: { width: 820, height: 1100 } });
  const pt = await ctxT.newPage();
  await pt.goto(BASE + '/?lead=lead_alfa_0000001');
  await pt.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
  await pt.waitForTimeout(500);
  ok('820px: sem scroll horizontal', (await pt.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
  await pt.screenshot({ path: 'shots/11-tablet-820.png', fullPage: true });

  // 14. nenhum modal e nenhum erro de console
  ok('nenhum modal/dialog aberto automaticamente', (await page.locator('[role="dialog"], dialog[open]').count()) === 0);
  const relevantes = erros.filter((e) => !/favicon|Failed to load resource: the server responded with a status of (404|400)/.test(e));
  ok('sem erro de JavaScript no console', relevantes.length === 0, relevantes.join(' | ').slice(0, 200));

  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('EXCECAO', e); process.exit(2); });
