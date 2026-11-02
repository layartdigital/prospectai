// QA-01 §8 — concorrencia na interface. Atrasos injetados no servidor da bancada
// fazem as respostas chegarem fora de ordem; o que se verifica e o que fica na tela.
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3199';
const out = [];
const PAINEL = '[data-tour="explorer-details"]';
const ok = (nome, cond, extra = '') => { out.push(`${cond ? 'PASS' : 'FAIL'} ${nome}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const atrasos = (ctxReq, lista) => ctxReq.get(`${BASE}/api/v1/__bench/atrasos?v=${encodeURIComponent(JSON.stringify(lista))}`);
const limpar = (ctxReq) => ctxReq.get(`${BASE}/api/v1/__bench/limpar`);
const chamadas = async (ctxReq) => (await (await ctxReq.get(`${BASE}/api/v1/__bench/chamadas`)).json());
const nos = (page, prefixo) => page.locator(`svg [data-no^="${prefixo}"]`).count();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const req = ctx.request;
  const erros = [];
  const nova = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    return p;
  };

  // C1 — Lead A e logo em seguida Lead B; a resposta de A chega DEPOIS da de B
  {
    await limpar(req);
    await atrasos(req, [{ padrao: '^graph\\|lead_alfa_0000001$', ms: 1800 }]);
    const p = await nova();
    await p.goto(BASE + '/');
    await p.waitForSelector('text=Clínica Sorriso Campinas');
    await p.getByRole('button', { name: /Clínica Sorriso Campinas/ }).click();
    await p.getByRole('button', { name: /OdontoVida Centro/ }).click();
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000002"]');
    await p.waitForTimeout(2600); // a resposta atrasada de A ja chegou ao navegador
    ok('C1 A depois B: o grafo final e o de B', (await nos(p, 'LEAD:lead_alfa_0000002')) === 1);
    ok('C1 resposta atrasada de A nao entra no grafo de B', (await nos(p, 'LEAD:lead_alfa_0000001')) === 0 && (await nos(p, 'SCORE:scr_alfa_000000001')) === 0);
    ok('C1 a URL e o painel acompanham B', p.url().includes('lead_alfa_0000002') && (await p.getByRole('heading', { name: 'OdontoVida Centro', level: 2 }).count()) > 0);
    await p.close();
  }

  // C2 — expande notas de A e seleciona B antes da resposta
  {
    await limpar(req);
    const p = await nova();
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await atrasos(req, [{ padrao: '^expand\\|LEAD:lead_alfa_0000001\\|NOTE', ms: 1800 }]);
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await p.getByRole('button', { name: /OdontoVida Centro/ }).click();
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000002"]');
    await p.waitForTimeout(2600);
    ok('C2 notas de A atrasadas nao aparecem no grafo de B', (await nos(p, 'NOTE:')) === 0 && (await nos(p, 'LEAD:lead_alfa_0000001')) === 0);
    ok('C2 o indicador de carregamento nao ficou preso', (await p.getByText('Carregando').count()) === 0);
    await p.close();
  }

  // C3 — filtros mudam durante a busca: a resposta velha nao sobrescreve a nova
  {
    await limpar(req);
    await atrasos(req, [{ padrao: '^leads\\|Odonto$', ms: 1800 }]);
    const p = await nova();
    await p.goto(BASE + '/');
    await p.waitForSelector('text=Clínica Sorriso Campinas');
    const campo = p.getByPlaceholder('Nome da empresa');
    await campo.fill('Odonto');
    await p.waitForTimeout(500); // debounce dispara a busca "Odonto" (atrasada)
    await campo.fill('Padaria');
    await p.waitForSelector('text=Padaria Pão Quente');
    await p.waitForTimeout(2300);
    const lista = await p.locator('body').innerText();
    ok('C3 a lista final e a do ultimo filtro', /Padaria Pão Quente/.test(lista));
    ok('C3 resposta atrasada do filtro anterior nao reapareceu', !/OdontoVida Centro/.test(lista));
    await p.close();
  }

  // C4 — reiniciar o grafo durante uma expansao
  {
    await limpar(req);
    const p = await nova();
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await atrasos(req, [{ padrao: '^expand\\|LEAD:lead_alfa_0000001\\|NOTE', ms: 1800 }]);
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await p.getByRole('button', { name: /Recomeçar deste lead/ }).click();
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await p.waitForTimeout(2600);
    ok('C4 reiniciar: o grafo volta ao estado inicial (5 nos)', (await p.locator('svg [data-no]').count()) === 5);
    ok('C4 notas da expansao interrompida nao entraram', (await nos(p, 'NOTE:')) === 0);
    // e o cursor foi zerado: carregar notas de novo traz a PRIMEIRA pagina (8), nao a segunda
    await limpar(req);
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await p.waitForFunction(() => document.querySelectorAll('svg [data-no^="NOTE:"]').length === 8);
    ok('C4 depois de reiniciar, a expansao recomeca da primeira pagina (8 notas)', true);
    await p.close();
  }

  // C5 — repetir rapidamente a mesma expansao: uma unica requisicao, sem duplicar
  {
    await limpar(req);
    const p = await nova();
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await atrasos(req, [{ padrao: '^expand\\|LEAD:lead_alfa_0000001\\|NOTE', ms: 900 }]);
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    const botao = p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ });
    await botao.evaluate((el) => { el.click(); el.click(); el.click(); }); // tres cliques antes de qualquer re-render
    await p.waitForFunction(() => document.querySelectorAll('svg [data-no^="NOTE:"]').length >= 8);
    await p.waitForTimeout(1500);
    const n = await nos(p, 'NOTE:');
    const feitas = (await chamadas(req)).filter((c) => c.startsWith('expand|LEAD:lead_alfa_0000001|NOTE'));
    ok('C5 tres cliques seguidos geram UMA requisicao', feitas.length === 1, `requisicoes=${feitas.length}`);
    ok('C5 o grafo tem 8 notas (sem duplicar nem pular pagina)', n === 8, `notas=${n}`);
    await p.close();
  }

  // C6 — duas expansoes diferentes sobrepostas: nenhuma apaga a outra
  {
    await limpar(req);
    const p = await nova();
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await atrasos(req, [
      { padrao: '^expand\\|LEAD:lead_alfa_0000001\\|NOTE', ms: 1200 },
      { padrao: '^expand\\|LEAD:lead_alfa_0000001\\|ACTIVITY', ms: 300 },
    ]);
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    const painel = p.locator(PAINEL);
    await painel.getByRole('button', { name: /^Nota\s*\(/ }).click();
    await painel.getByRole('button', { name: /^Atividade\s*\(/ }).click();
    await p.waitForTimeout(2000);
    ok('C6 notas E atividades presentes (a resposta mais lenta nao apagou a mais rapida)', (await nos(p, 'NOTE:')) === 8 && (await nos(p, 'ACTIVITY:')) === 3, `notas=${await nos(p, 'NOTE:')} atividades=${await nos(p, 'ACTIVITY:')}`);
    await p.close();
  }

  // C7 — troca de workspace/sessao no meio da navegacao: a prova assinada impede misturar
  {
    await limpar(req);
    const p = await nova();
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await ctx.addCookies([{ name: 'as', value: 'beta', url: BASE }]); // a sessao passa a ser do Beta
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await p.getByText(/Prova de profundidade inválida/).waitFor();
    ok('C7 expansao com a sessao trocada e recusada com mensagem clara', true);
    ok('C7 nenhuma nota entrou no grafo', (await nos(p, 'NOTE:')) === 0);
    await ctx.addCookies([{ name: 'as', value: 'alfa', url: BASE }]);
    await p.close();
  }

  await limpar(req);
  const relevantes = erros.filter((e) => !/favicon|Failed to load resource: the server responded with a status of (404|400)|net::ERR_ABORTED/.test(e));
  ok('sem erro de JavaScript no console durante as corridas', relevantes.length === 0, relevantes.join(' | ').slice(0, 300));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('EXCECAO', e); process.exit(2); });
