import { expect, test } from '@playwright/test';

import {
  abrirExplorer,
  botaoDeRelacao,
  carregarRelacao,
  entrarComo,
  evidencia,
  grafoPelaApi,
  manifesto,
  no,
  observarErrosDePagina,
  painelDetalhes,
  refLead,
  refsDoGrafo,
  refsDoTipo,
  selecionarNo,
  semDuplicados,
  voltarParaAAba,
  zoomAtual,
  type GrafoDaApi,
} from './explorer-support';

/**
 * E2E-04 (expansao, paginacao, duplicacao e limites) e E2E-05 (interface).
 *
 * Aplicacao real de ponta a ponta; as unicas "respostas" que a tela recebe sao
 * as da API NestJS lendo o PostgreSQL com RLS.
 */

test.describe.configure({ mode: 'serial' });

test.describe('E2E-04 expansao, paginacao e limites', () => {
  test('E2E-04a: relacoes de varios itens paginam, nao duplicam e fecham em "Completo"', async ({ page }) => {
    const m = manifesto();
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    const notas = page.locator('svg [data-no^="NOTE:"]');
    await expect(notas).toHaveCount(0);

    // 11 notas, 8 por pagina: 8 e depois 3.
    await carregarRelacao(page, 'Nota');
    await expect(notas).toHaveCount(8);
    await expect(botaoDeRelacao(page, 'Nota')).toContainText('(8 de 11 no grafo)');

    await carregarRelacao(page, 'Nota');
    await expect(notas).toHaveCount(11);
    await expect(botaoDeRelacao(page, 'Nota')).toContainText('(11 de 11 no grafo)');
    await expect(botaoDeRelacao(page, 'Nota')).toContainText('Completo');
    await expect(botaoDeRelacao(page, 'Nota')).toBeDisabled();

    // Duplo clique rapido: a mesma pagina nao pode ser pedida duas vezes.
    const pedidosDeAtividade: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/intelligence/expand') && r.url().includes('kind=ACTIVITY')) {
        pedidosDeAtividade.push(r.url());
      }
    });
    await botaoDeRelacao(page, 'Atividade').dblclick();
    await expect(page.locator('svg [data-no^="ACTIVITY:"]')).toHaveCount(m.alfa.atividades);
    expect(pedidosDeAtividade, 'duplo clique gera um unico pedido').toHaveLength(1);

    await carregarRelacao(page, 'Contato registrado');
    await carregarRelacao(page, 'Follow-up');
    await expect(page.locator('svg [data-no^="CONTACT_RECORD:"]')).toHaveCount(m.alfa.contatos);
    await expect(page.locator('svg [data-no^="FOLLOW_UP:"]')).toHaveCount(m.alfa.followUps);

    const refs = await refsDoGrafo(page);
    expect(semDuplicados(refs), 'nenhum no repetido').toBe(true);
    // 5 iniciais + 11 notas + 4 atividades + 2 contatos + 1 follow-up
    expect(refs).toHaveLength(5 + m.alfa.notas + m.alfa.atividades + m.alfa.contatos + m.alfa.followUps);

    // Uma nota carregada mostra o texto da fixture e a origem da ligacao.
    const primeiraNota = refsDoTipo(refs, 'NOTE')[0];
    expect(primeiraNota).toBeDefined();
    await selecionarNo(page, primeiraNota ?? '');
    await expect(painelDetalhes(page)).toContainText(/Nota E2E Alfa \d\d/);
    await expect(painelDetalhes(page).getByText('Vínculo no cadastro', { exact: true })).toHaveCount(1);

    await evidencia(page, 'e2e-04-expansao-do-hub');
  });

  test('E2E-04b: pesquisa pagina os leads sem contar o removido e o teto de profundidade vale na tela', async ({ page }) => {
    const m = manifesto();
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    const refs0 = await refsDoGrafo(page);
    const pesquisa = refsDoTipo(refs0, 'SEARCH')[0];
    expect(pesquisa).toBeDefined();
    await selecionarNo(page, pesquisa ?? '');

    // Total mostrado ignora o lead removido (soft delete): 12 e nao 13.
    await expect(botaoDeRelacao(page, 'Lead')).toContainText(`de ${m.alfa.leadsNaPesquisa} no grafo`);

    // 12 leads, 8 por pagina: duas paginas.
    await carregarRelacao(page, 'Lead');
    await carregarRelacao(page, 'Lead');
    const leads = page.locator('svg [data-no^="LEAD:"]');
    await expect(leads).toHaveCount(m.alfa.leadsNaPesquisa);
    await expect(botaoDeRelacao(page, 'Lead')).toContainText('Completo');

    const refs1 = await refsDoGrafo(page);
    expect(semDuplicados(refs1)).toBe(true);
    expect(refs1, 'o lead removido nunca entra no grafo').not.toContain(refLead(m.alfa.removido.id));
    for (const s of m.alfa.satelites) expect(refs1).toContain(refLead(s.id));

    // Profundidade: lead(0) > pesquisa(1) > satelite(2) > presenca(3) > sinal(4) e recusado.
    const satelite = m.alfa.satelites[0];
    expect(satelite).toBeDefined();
    await selecionarNo(page, refLead(satelite?.id ?? ''));
    const antes = new Set(await refsDoGrafo(page));
    await carregarRelacao(page, 'Presença digital');
    const depois = await refsDoGrafo(page);
    const presencaNova = depois.find((r) => r.startsWith('PRESENCE:') && !antes.has(r));
    expect(presencaNova, 'presenca do satelite entrou no grafo').toBeDefined();

    await selecionarNo(page, presencaNova ?? '');
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/intelligence/expand')),
      botaoDeRelacao(page, 'Sinal').click(),
    ]);
    expect(resposta.status()).toBe(400);
    await expect(painelDetalhes(page).getByRole('alert')).toContainText('Profundidade máxima');
    expect(refsDoTipo(await refsDoGrafo(page), 'SIGNAL'), 'nenhum sinal alem do teto').toHaveLength(0);

    await evidencia(page, 'e2e-04-teto-de-profundidade');
  });

  test('E2E-04c: limites e provas impostos pelo servidor (API real, sessao do navegador)', async ({ page }) => {
    const m = manifesto();
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    const raiz = refLead(m.alfa.hub.id);
    const g = JSON.parse((await grafoPelaApi(page, m.alfa.hub.id)).corpo) as GrafoDaApi;
    expect(g.limits.maxPageSize).toBe(25);
    expect(g.limits.maxNodesPerResponse).toBe(60);
    expect(g.limits.maxNodesOnCanvas).toBe(150);
    expect(Object.keys(g.omitted), 'grafo inicial pequeno: nada omitido').toHaveLength(0);

    const noRaiz = g.nodes.find((n) => n.ref === raiz);
    const noPesquisa = g.nodes.find((n) => n.kind === 'SEARCH');
    expect(noRaiz?.depthProof).toBeTruthy();
    expect(noPesquisa?.depthProof).toBeTruthy();

    const url = (extra: string, ref = raiz, depth = noRaiz?.depth ?? 0, prova = noRaiz?.depthProof ?? ''): string =>
      `/api/v1/intelligence/expand?ref=${encodeURIComponent(ref)}&kind=NOTE&parentDepth=${depth}` +
      `&parentDepthProof=${encodeURIComponent(prova)}${extra}`;

    // Pagina maxima aceita: as 11 notas cabem em uma pagina de 25.
    const ok = await page.request.get(url('&pageSize=25'));
    expect(ok.status()).toBe(200);
    const corpo = (await ok.json()) as { nodes: unknown[]; expanded: { nextOffset: number | null } };
    expect(corpo.nodes).toHaveLength(m.alfa.notas);
    expect(corpo.expanded.nextOffset).toBeNull();

    // Fora do contrato: recusado antes de qualquer leitura.
    expect((await page.request.get(url('&pageSize=26'))).status()).toBe(400);
    expect((await page.request.get(url('&pageSize=0'))).status()).toBe(400);
    expect((await page.request.get(url('&offset=-1'))).status()).toBe(400);

    // Profundidade adulterada (a prova assinada era para 0).
    const adulterada = await page.request.get(url('', raiz, 1));
    expect(adulterada.status()).toBe(400);
    expect(await adulterada.text()).toContain('Prova de profundidade inválida');

    // Prova valida de OUTRO no nao serve para este.
    const trocada = await page.request.get(url('', raiz, noPesquisa?.depth ?? 1, noPesquisa?.depthProof ?? ''));
    expect(trocada.status()).toBe(400);

    // Combinacao de tipos nao permitida.
    const combinacao = await page.request.get(
      `/api/v1/intelligence/expand?ref=${encodeURIComponent(raiz)}&kind=SCORE_REASON&parentDepth=0` +
        `&parentDepthProof=${encodeURIComponent(noRaiz?.depthProof ?? '')}`,
    );
    expect(combinacao.status()).toBe(400);

    // Posicao alem do fim: pagina vazia, sem erro e sem repetir itens.
    const alemDoFim = await page.request.get(url('&offset=500'));
    expect(alemDoFim.status()).toBe(200);
    expect(((await alemDoFim.json()) as { nodes: unknown[] }).nodes).toHaveLength(0);
  });
});

test.describe('E2E-05 interface do Explorer', () => {
  test('E2E-05a: selecao, painel, proveniencia, zoom, teclado e filtros por tipo', async ({ page }) => {
    const m = manifesto();
    const errosDePagina = observarErrosDePagina(page);
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    const raiz = refLead(m.alfa.hub.id);
    const painel = painelDetalhes(page);

    // Alternativa em texto ao grafo: um item por entidade.
    const lista = page.getByRole('list', { name: 'Entidades do grafo em lista' });
    await expect(lista.getByRole('listitem')).toHaveCount(5);

    // Teclado: foco no grafo, Tab leva a uma entidade, Enter seleciona, Esc limpa.
    const tela = page.getByRole('group', { name: /^Grafo de relações/ });
    await tela.focus();
    await page.keyboard.press('Tab');
    const focado = await page.evaluate(() => document.activeElement?.getAttribute('data-no') ?? '');
    expect(focado).toMatch(/^[A-Z_]+:/);
    await page.keyboard.press('Enter');
    await expect(no(page, focado)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(painel.getByText(/Selecione uma entidade no grafo/)).toBeVisible();

    // Mouse: enquadrar e clicar na raiz.
    await page.getByRole('button', { name: 'Enquadrar tudo' }).click();
    await no(page, raiz).click();
    await expect(no(page, raiz)).toHaveAttribute('aria-pressed', 'true');
    await expect(painel.getByRole('heading', { level: 2, name: m.alfa.hub.name })).toBeVisible();
    await expect(painel.getByText('Categoria', { exact: true })).toBeVisible();

    // Zoom pelos botoes.
    const z0 = await zoomAtual(page);
    await page.getByRole('button', { name: 'Aproximar' }).click();
    await expect.poll(() => zoomAtual(page)).toBeGreaterThan(z0);
    const zMais = await zoomAtual(page);
    await page.getByRole('button', { name: 'Afastar' }).click();
    await page.getByRole('button', { name: 'Afastar' }).click();
    await expect.poll(() => zoomAtual(page)).toBeLessThan(zMais);
    await page.getByRole('button', { name: 'Enquadrar tudo' }).click();
    await expect.poll(() => zoomAtual(page)).toBeGreaterThan(0);

    // Zoom pelo teclado (mais, menos, zero).
    await tela.focus();
    const zAntes = await zoomAtual(page);
    await page.keyboard.press('+');
    await expect.poll(() => zoomAtual(page)).toBeGreaterThan(zAntes);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await expect.poll(() => zoomAtual(page)).toBeLessThan(zAntes);
    await page.keyboard.press('0');

    // Filtro por tipo: esconder e mostrar o cartao do pipeline; o lead e fixo.
    const tipos = page.getByRole('region', { name: 'Tipos de entidade no grafo' });
    const cartao = refsDoTipo(await refsDoGrafo(page), 'PIPELINE_CARD')[0] ?? '';
    expect(cartao).not.toBe('');
    const caixaCartao = tipos.getByRole('checkbox', { name: /Cartão no pipeline/ });
    await expect(caixaCartao).toBeChecked();
    await caixaCartao.uncheck();
    await expect(no(page, cartao)).toHaveCount(0);
    await caixaCartao.check();
    await expect(no(page, cartao)).toHaveCount(1);
    const caixaLead = tipos.getByRole('checkbox', { name: /^Lead\b/ });
    await expect(caixaLead).toBeChecked();
    await expect(caixaLead).toBeDisabled();

    // Proveniencia dos sinais: ausencia de verificacao e DESCONHECIDO, nunca AUSENTE.
    const presenca = refsDoTipo(await refsDoGrafo(page), 'PRESENCE')[0] ?? '';
    await selecionarNo(page, presenca);
    await carregarRelacao(page, 'Sinal');
    const sinais = refsDoTipo(await refsDoGrafo(page), 'SIGNAL');
    expect(sinais).toHaveLength(7);

    const sinal = (campo: string): string => sinais.find((r) => r.endsWith(`:${campo}`)) ?? '';
    await selecionarNo(page, sinal('hasInstagram'));
    await expect(painel.getByText('Desconhecido', { exact: true }).first()).toBeVisible();
    await expect(painel.getByText(/^Origem:/)).toHaveCount(1);
    await selecionarNo(page, sinal('hasWebsite'));
    await expect(painel.getByText('Presente', { exact: true }).first()).toBeVisible();
    await selecionarNo(page, sinal('hasEmail'));
    await expect(painel.getByText('Ausente', { exact: true }).first()).toBeVisible();

    // Etapa comercial do cartao e motivos do score.
    await selecionarNo(page, cartao);
    await carregarRelacao(page, 'Etapa comercial');
    const etapa = refsDoTipo(await refsDoGrafo(page), 'PIPELINE_STAGE')[0] ?? '';
    await selecionarNo(page, etapa);
    await expect(painel.getByRole('heading', { level: 2, name: 'Respondeu' })).toBeVisible();

    const score = refsDoTipo(await refsDoGrafo(page), 'SCORE')[0] ?? '';
    await selecionarNo(page, score);
    // A API devolve os motivos (as fixtures usam o motor de score real: 8 motivos) e
    // a tela precisa te-los desenhado quando `carregarRelacao` retorna.
    const motivos = await carregarRelacao(page, 'Motivo do score');
    expect(motivos.length, 'a API devolveu motivos do score').toBeGreaterThan(0);
    expect(motivos.every((r) => r.startsWith('SCORE_REASON:'))).toBe(true);
    await expect(page.locator('svg [data-no^="SCORE_REASON:"]')).toHaveCount(motivos.length);
    expect(semDuplicados(await refsDoGrafo(page))).toBe(true);

    await evidencia(page, 'e2e-05-interface-completa');
    expect(errosDePagina, 'nenhuma excecao de JavaScript na pagina').toEqual([]);
  });

  test('E2E-05b: estados vazio, sem resultado, erro, recuperacao e lead removido', async ({ page }) => {
    const m = manifesto();
    const errosDePagina = observarErrosDePagina(page);
    await entrarComo(page, 'alfa');

    // Vazio: nenhum lead escolhido.
    await page.goto('/intelligence');
    await expect(page.getByText('Nenhum lead selecionado')).toBeVisible();
    await evidencia(page, 'e2e-05-estado-vazio');

    // Busca sem resultado.
    const busca = page.getByPlaceholder('Nome da empresa');
    await busca.fill('zzzz-sem-resultado-e2e');
    await expect(page.getByText('Nenhum lead encontrado com estes filtros.')).toBeVisible();

    // Lead removido (soft delete) nao aparece na busca...
    await busca.fill('Alfa Removido');
    await expect(page.getByText('Nenhum lead encontrado com estes filtros.')).toBeVisible();

    // ...nem abre grafo, nem tem ficha.
    await page.goto(`/intelligence?lead=${m.alfa.removido.id}`);
    const alerta = page.getByRole('alert').filter({ hasText: 'Não foi possível montar o grafo' });
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText('Não encontrado neste workspace');
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(m.alfa.removido.name);
    await expect(page.locator('svg [data-no]')).toHaveCount(0);
    await evidencia(page, 'e2e-05-estado-de-erro');

    await page.goto(`/leads/${m.alfa.removido.id}`);
    await expect(page.getByText(/404|could not be found|não encontrad/i).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(m.alfa.removido.name);

    // Id malformado: o servidor recusa e a tela mostra o erro, sem quebrar.
    await page.goto('/intelligence?lead=x');
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível montar o grafo' })).toBeVisible();

    // Recuperacao: escolher um lead valido pela busca.
    await page.getByPlaceholder('Nome da empresa').fill('Alfa Hub');
    await page.getByRole('button', { name: new RegExp(m.alfa.hub.name) }).click();
    await page.waitForURL(new RegExp(`/intelligence\\?lead=${m.alfa.hub.id}$`));
    await expect(no(page, refLead(m.alfa.hub.id))).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível montar o grafo' })).toHaveCount(0);

    // A aba some e volta (evento de foco): nada muda para a mesma sessao.
    await voltarParaAAba(page);
    await expect(no(page, refLead(m.alfa.hub.id))).toBeVisible();

    expect(errosDePagina, 'nenhuma excecao de JavaScript na pagina').toEqual([]);
  });
});
