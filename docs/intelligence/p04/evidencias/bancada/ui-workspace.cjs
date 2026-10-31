// P04-QA-02 item 4 — troca de workspace / sessao com o Explorer ABERTO.
// O que se verifica e o ESTADO VISIVEL (texto e DOM), nao so a recusa do servidor.
// Bancada: `entry.tsx` emula layout+pagina do Next (key por identidade, refresh -> /auth/me).
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3199';
const SHOTS = process.env.SHOTS ?? 'shots';
const out = [];
const ok = (nome, cond, extra = '') => { out.push(`${cond ? 'PASS' : 'FAIL'} ${nome}${extra ? ' — ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const PAINEL = '[data-tour="explorer-details"]';
const NOMES_ALFA = ['Clínica Sorriso Campinas', 'Dra. Helena Ortodontia', 'Implante Prime', 'OdontoVida Centro', 'Padaria Pão Quente'];
const atrasos = (r, lista) => r.get(`${BASE}/api/v1/__bench/atrasos?v=${encodeURIComponent(JSON.stringify(lista))}`);
const limpar = (r) => r.get(`${BASE}/api/v1/__bench/limpar`);
const chamadas = async (r) => (await (await r.get(`${BASE}/api/v1/__bench/chamadas`)).json());

// Qualquer rastro do workspace Alfa no que o usuario ve ou no DOM (nomes e ids).
async function rastrosAlfa(p) {
  return p.evaluate((nomes) => {
    const txt = document.body.innerText; const html = document.body.innerHTML;
    return { nomes: nomes.filter((n) => txt.includes(n)), ids: (html.match(/[A-Za-z]+_alfa_\d+/g) ?? []).length, nos: document.querySelectorAll('svg [data-no]').length };
  }, NOMES_ALFA);
}
const limpo = (r) => r.nomes.length === 0 && r.ids === 0;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const req = ctx.request;
  const erros = [];
  const sessao = (as, usr = 'u1') => ctx.addCookies([{ name: 'as', value: as, url: BASE }, { name: 'usr', value: usr, url: BASE }]);
  const nova = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => erros.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); }); return p; };
  const abrirAlfa = async (p, comNotas = true) => {
    await sessao('alfa');
    await p.goto(BASE + '/?lead=lead_alfa_0000001');
    await p.waitForSelector('[data-no="LEAD:lead_alfa_0000001"]');
    await p.locator('[data-no="LEAD:lead_alfa_0000001"]').click();
    if (comNotas) {
      await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
      await p.waitForFunction(() => document.querySelectorAll('svg [data-no^="NOTE:"]').length === 8);
    }
  };
  const focar = (p) => p.evaluate(() => window.dispatchEvent(new Event('focus')));

  // W1 — troca Alfa -> Beta com o grafo, a selecao, o painel e a busca abertos
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p);
    let antes = await rastrosAlfa(p);
    ok('W1 pre-condicao: o Explorer mostra dados do Alfa (nos, nomes, painel)', antes.nos >= 13 && antes.nomes.length >= 1 && (await p.locator(PAINEL).innerText()).length > 0, `nos=${antes.nos} nomes=${antes.nomes.length}`);
    await p.screenshot({ path: `${SHOTS}/troca-1-antes-alfa.png` });

    // a sessao do navegador passa a ser do Beta, sem nenhuma interacao na tela
    await sessao('beta');
    // atrasa SO a releitura de sessao do "servidor" (refresh) para capturar o estado intermediario
    let leituras = 0;
    await p.route('**/api/v1/auth/me', async (rota) => { leituras += 1; if (leituras >= 2) await new Promise((r) => setTimeout(r, 1500)); await rota.continue(); });
    await focar(p);
    await p.getByTestId('explorer-sessao-mudou').waitFor({ timeout: 4000 });
    const meio = await rastrosAlfa(p);
    ok('W1 aviso "sessao ou workspace mudou" aparece', true);
    ok('W1 durante o aviso: ZERO rastro do Alfa na tela e no DOM (nomes, ids, nos)', limpo(meio) && meio.nos === 0, JSON.stringify(meio));
    ok('W1 detalhes do no sumiram (nenhum painel de no, nenhum botao Carregar)', (await p.locator(PAINEL).count()) === 0 && (await p.getByRole('button', { name: /^Nota\s*\(/ }).count()) === 0);
    await p.screenshot({ path: `${SHOTS}/troca-2-aviso-descartado.png` });

    await p.getByText('Nenhum lead selecionado').waitFor({ timeout: 6000 });
    await p.unroute('**/api/v1/auth/me');
    const depois = await rastrosAlfa(p);
    ok('W1 apos o servidor entregar a identidade nova: tela vazia de Alfa', limpo(depois) && depois.nos === 0, JSON.stringify(depois));
    // (na bancada a rota inicial era '/'; o produto faz router.replace('/intelligence'), a rota do proprio Explorer)
    ok('W1 permaneceu na rota do Explorer (/intelligence), sem o lead do workspace anterior', new URL(p.url()).pathname === '/intelligence' && !new URL(p.url()).searchParams.has('lead'), p.url());
    await p.getByText('Academia Beta Fit').waitFor({ timeout: 4000 });
    ok('W1 o workspace novo e o do Beta (busca lista so o Beta)', (await p.getByTestId('bench-sessao').innerText()).startsWith('beta/') && (await rastrosAlfa(p)).nomes.length === 0);
    ok('W1 nenhum estado antigo: filtro de tipos e lista de acessibilidade ausentes', (await p.getByText('Tipos no grafo').count()) === 0 && (await p.locator('ul[aria-label="Entidades do grafo em lista"]').count()) === 0);
    await p.screenshot({ path: `${SHOTS}/troca-3-depois-beta.png` });
    await sessao('alfa'); await p.close();
  }

  // W2 — requisicao PENDENTE (expansao de notas do Alfa) quando a sessao troca: a resposta tardia nao entra
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p, false);
    await atrasos(req, [{ padrao: '^expand\\|LEAD:lead_alfa_0000001\\|NOTE', ms: 1800 }]);
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await sessao('beta');
    await focar(p);
    await p.getByText('Nenhum lead selecionado').waitFor({ timeout: 6000 });
    await p.waitForTimeout(2800); // a resposta do Alfa (notas) chega ao navegador DEPOIS da troca
    const r = await rastrosAlfa(p);
    ok('W2 expansao pendente: houve a chamada de expansao antes da troca', (await chamadas(req)).some((c) => c.startsWith('expand|LEAD:lead_alfa_0000001|NOTE')));
    ok('W2 a resposta tardia do Alfa nao entrou: nenhuma nota, nenhum rastro', r.nos === 0 && limpo(r) && (await p.locator('svg [data-no^="NOTE:"]').count()) === 0, JSON.stringify(r));
    ok('W2 sem indicador de carregamento preso', (await p.getByText('Carregando').count()) === 0 && (await p.getByText('Montando o grafo').count()) === 0);
    await sessao('alfa'); await p.close();
  }

  // W3 — requisicao PENDENTE de carregar GRAFO do Alfa quando a sessao troca
  {
    await limpar(req);
    await sessao('alfa');
    const p = await nova();
    await p.goto(BASE + '/');
    await p.waitForSelector('text=OdontoVida Centro');
    await atrasos(req, [{ padrao: '^graph\\|lead_alfa_0000002$', ms: 1800 }]);
    await p.getByRole('button', { name: /OdontoVida Centro/ }).click();
    await p.getByText('Montando o grafo').waitFor();
    await sessao('beta');
    await focar(p);
    await p.getByText('Nenhum lead selecionado').waitFor({ timeout: 6000 });
    await p.waitForTimeout(2800);
    const r = await rastrosAlfa(p);
    ok('W3 grafo pendente do Alfa chegou tarde e nao foi desenhado', r.nos === 0 && limpo(r), JSON.stringify(r));
    await sessao('alfa'); await p.close();
  }

  // W4 — logout em outra aba (sessao encerrada): tela de login, sem rastro
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p);
    await sessao('fora');
    await focar(p);
    await p.getByTestId('bench-login').waitFor({ timeout: 6000 });
    const r = await rastrosAlfa(p);
    ok('W4 logout: o Explorer sai da tela (redirect /login) sem rastro do workspace', limpo(r) && r.nos === 0, JSON.stringify(r));
    await sessao('alfa'); await p.close();
  }

  // W5 — troca de USUARIO dentro do mesmo workspace
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p);
    await sessao('alfa', 'u2');
    await focar(p);
    await p.getByText('Nenhum lead selecionado').waitFor({ timeout: 6000 });
    const r = await rastrosAlfa(p);
    ok('W5 outro usuario no mesmo workspace: grafo, selecao e lead da URL descartados', r.nos === 0 && !new URL(p.url()).searchParams.has('lead') && (await p.getByTestId('bench-sessao').innerText()) === 'alfa/usr_u2', `${p.url()} nos=${r.nos}`);
    await sessao('alfa'); await p.close();
  }

  // W6 — nenhuma troca: foco repetido, rede fora e erro 500 NAO apagam o trabalho (sem falso positivo)
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p);
    const nosAntes = await p.locator('svg [data-no]').count();
    await focar(p); await focar(p); await p.waitForTimeout(600);
    ok('W6 foco com a mesma identidade nao descarta nada', (await p.locator('svg [data-no]').count()) === nosAntes && (await p.getByTestId('explorer-sessao-mudou').count()) === 0);
    await p.route('**/api/v1/auth/me', (rota) => rota.abort());
    await focar(p); await p.waitForTimeout(600);
    ok('W6 rede fora na checagem de sessao nao descarta nada', (await p.locator('svg [data-no]').count()) === nosAntes);
    await p.unroute('**/api/v1/auth/me');
    await p.route('**/api/v1/auth/me', (rota) => rota.fulfill({ status: 500, body: '{}' }));
    await focar(p); await p.waitForTimeout(600);
    ok('W6 erro 500 na checagem de sessao nao descarta nada', (await p.locator('svg [data-no]').count()) === nosAntes);
    await p.unroute('**/api/v1/auth/me'); await p.close();
  }

  // W7 — o proprio Explorer recebe 401 numa expansao: confirma a sessao e sai, sem rastro
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p, false);
    await sessao('fora');
    await p.locator(PAINEL).getByRole('button', { name: /^Nota\s*\(/ }).click();
    await p.getByTestId('bench-login').waitFor({ timeout: 6000 });
    const r = await rastrosAlfa(p);
    ok('W7 401 numa requisicao do Explorer leva a sessao encerrada e limpa a tela', limpo(r) && r.nos === 0, JSON.stringify(r));
    await sessao('alfa'); await p.close();
  }

  // W8 — sem nenhum evento: a checagem periodica (20 s) tambem detecta
  {
    await limpar(req);
    const p = await nova();
    await abrirAlfa(p);
    await sessao('beta');
    const t0 = Date.now();
    await p.getByText('Nenhum lead selecionado').waitFor({ timeout: 26000 });
    const dt = Math.round((Date.now() - t0) / 1000);
    const r = await rastrosAlfa(p);
    ok('W8 sem foco nem clique, a checagem periodica descarta o grafo do Alfa', limpo(r) && r.nos === 0, `detectou em ~${dt}s`);
    await sessao('alfa'); await p.close();
  }

  await limpar(req);
  const relevantes = erros.filter((e) => !/favicon|Failed to load resource|net::ERR_/.test(e));
  ok('sem erro de JavaScript no console durante as trocas', relevantes.length === 0, relevantes.join(' | ').slice(0, 300));
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('EXCECAO', e); process.exit(2); });
