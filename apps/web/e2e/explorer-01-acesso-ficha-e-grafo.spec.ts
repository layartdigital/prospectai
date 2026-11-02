import { expect, test } from '@playwright/test';

import { aguardarHidratacao } from './helpers';
import {
  abrirExplorer,
  entrarComo,
  evidencia,
  grafoPelaApi,
  manifesto,
  no,
  painelDetalhes,
  refLead,
  refsDoGrafo,
  refsDoTipo,
  semDuplicados,
  type GrafoDaApi,
} from './explorer-support';

/**
 * E2E-01, E2E-02 e E2E-03 — Intelligence Explorer na aplicacao real.
 *
 * Next (build de producao), NestJS, Prisma e PostgreSQL reais, atras do gateway
 * same-origin. Os dados sao as fixtures sinteticas do Alfa (tenant de
 * demonstracao): o lead-hub tem pesquisa, score, presenca digital e cartao no
 * pipeline, mais 11 notas, 4 atividades, 2 contatos e 1 follow-up — e NENHUMA
 * auditoria, entao nenhuma relacao de auditoria pode aparecer no grafo.
 */

test.describe.configure({ mode: 'serial' });

test.describe('E2E-01 autenticacao e acesso ao Explorer', () => {
  test('E2E-01a: sem sessao, /intelligence e a API do grafo recusam o acesso', async ({ page, request }) => {
    const m = manifesto();

    await page.goto('/intelligence');
    await expect(page).toHaveURL(/\/login/);

    const semSessao = await request.get(`/api/v1/intelligence/graph?leadId=${m.alfa.hub.id}`);
    expect(semSessao.status()).toBe(401);
    expect(await semSessao.text()).not.toContain(m.alfa.hub.name);
  });

  test('E2E-01b: credencial errada nao autentica e nao abre o Explorer', async ({ page }) => {
    const m = manifesto();
    await page.context().clearCookies();
    await page.goto('/login');
    await aguardarHidratacao(page, 'Entrar');
    await page.getByLabel('E-mail').fill(m.alfa.email);
    await page.getByLabel('Senha').fill('senha-errada-do-e2e-123');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/intelligence');
    await expect(page).toHaveURL(/\/login/);
  });

  test('E2E-01c: login pela interface leva ao dashboard e libera o Explorer', async ({ page }) => {
    await entrarComo(page, 'alfa');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/intelligence');
    await expect(page.getByRole('heading', { level: 1, name: /Intelligence Explorer/ })).toBeVisible();
    await expect(page.getByText('Nenhum lead selecionado')).toBeVisible();
    // Carregar a pagina nunca abre modal de bloqueio (regra 5 do projeto).
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('E2E-02 integracao com a ficha do lead', () => {
  test('E2E-02: lista de leads > ficha > "Explorar relacoes" > Explorer com o mesmo lead', async ({ page }) => {
    const m = manifesto();
    await entrarComo(page, 'alfa');

    // Lista de leads (renderizada no servidor, com busca no servidor).
    await page.goto(`/leads?search=${encodeURIComponent(m.alfa.hub.name)}`);
    const linha = page.getByRole('row').filter({ hasText: m.alfa.hub.name });
    await expect(linha).toHaveCount(1);
    await linha.getByRole('link').first().click();

    // Ficha do lead.
    await page.waitForURL(new RegExp(`/leads/${m.alfa.hub.id}$`), { timeout: 60_000 });
    await expect(page.getByText(m.alfa.hub.name).first()).toBeVisible();
    await evidencia(page, 'e2e-02-ficha-do-lead');

    // Botao que leva ao Explorer.
    const explorar = page.getByRole('link', { name: 'Explorar relações' });
    await expect(explorar).toBeVisible();
    await expect(explorar).toHaveAttribute('href', `/intelligence?lead=${m.alfa.hub.id}`);
    await explorar.click();

    await page.waitForURL(new RegExp(`/intelligence\\?lead=${m.alfa.hub.id}$`), { timeout: 60_000 });
    await expect(no(page, refLead(m.alfa.hub.id))).toBeVisible({ timeout: 60_000 });

    // O lead de partida e o da ficha: raiz selecionada e painel com o nome certo.
    await expect(painelDetalhes(page).getByRole('heading', { level: 2, name: m.alfa.hub.name })).toBeVisible();
    await evidencia(page, 'e2e-02-explorer-a-partir-da-ficha');
  });

  test('E2E-02b: o item "Intelligence" do menu abre o Explorer', async ({ page }) => {
    await entrarComo(page, 'alfa');
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: /Intelligence/ })
      .click();
    await page.waitForURL(/\/intelligence$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1, name: /Intelligence Explorer/ })).toBeVisible();
  });
});

test.describe('E2E-03 grafo inicial real', () => {
  test('E2E-03: so entram as relacoes que existem nas fixtures, com proveniencia', async ({ page }) => {
    const m = manifesto();
    await entrarComo(page, 'alfa');
    await abrirExplorer(page, m.alfa.hub.id);

    // 1) Quais nos o navegador desenhou.
    const refs = await refsDoGrafo(page);
    expect(semDuplicados(refs)).toBe(true);
    expect(refsDoTipo(refs, 'LEAD')).toEqual([refLead(m.alfa.hub.id)]);
    for (const kind of ['SEARCH', 'SCORE', 'PRESENCE', 'PIPELINE_CARD']) {
      expect(refsDoTipo(refs, kind), `um no ${kind}`).toHaveLength(1);
    }
    // Relacoes de varios itens ficam so como contagem; auditoria nao existe nas fixtures.
    for (const kind of ['NOTE', 'ACTIVITY', 'CONTACT_RECORD', 'FOLLOW_UP', 'AUDIT', 'AUDIT_CHECK', 'SIGNAL', 'SCORE_REASON', 'PIPELINE_STAGE']) {
      expect(refsDoTipo(refs, kind), `nenhum no ${kind} no grafo inicial`).toHaveLength(0);
    }
    expect(refs).toHaveLength(5);

    // 2) O que a API (a mesma que a tela chamou) devolve: os dois lados concordam.
    const api = await grafoPelaApi(page, m.alfa.hub.id);
    expect(api.status).toBe(200);
    const corpo = JSON.parse(api.corpo) as GrafoDaApi;
    expect(corpo.rootRef).toBe(refLead(m.alfa.hub.id));
    expect(corpo.nodes.map((n) => n.ref).sort()).toEqual([...refs].sort());
    expect(corpo.edges).toHaveLength(4);
    for (const e of corpo.edges) {
      expect(e.verification, 'toda aresta tem vinculo comprovado no cadastro').toBe('VERIFICADA');
      expect(e.provenance.kind).toBe('FOREIGN_KEY');
    }
    for (const n of corpo.nodes) expect(n.depthProof, `prova de profundidade em ${n.ref}`).toBeTruthy();
    expect(corpo.limits.maxNodesPerResponse).toBe(60);
    expect(corpo.limits.maxDepth).toBe(3);

    // 3) Painel da raiz: dados do lead, quatro conexoes, todas com origem e selo.
    const painel = painelDetalhes(page);
    await expect(painel.getByRole('heading', { level: 2, name: m.alfa.hub.name })).toBeVisible();
    await expect(painel.getByText('Conexões (4)')).toBeVisible();
    await expect(painel.getByText('Vínculo no cadastro', { exact: true })).toHaveCount(4);
    await expect(painel.getByText(/^Origem:/)).toHaveCount(4);
    await expect(painel.getByText('Inferência (não comprovada)')).toHaveCount(0);

    // 4) Contagens de relacoes de varios itens batem com as fixtures.
    await expect(painel.getByRole('button', { name: new RegExp(`Nota\\s*\\(0 de ${m.alfa.notas} no grafo\\)`) })).toBeVisible();
    await expect(painel.getByRole('button', { name: new RegExp(`Atividade\\s*\\(0 de ${m.alfa.atividades} no grafo\\)`) })).toBeVisible();
    await expect(painel.getByRole('button', { name: new RegExp(`Contato registrado\\s*\\(0 de ${m.alfa.contatos} no grafo\\)`) })).toBeVisible();
    await expect(painel.getByRole('button', { name: new RegExp(`Follow-up\\s*\\(0 de ${m.alfa.followUps} no grafo\\)`) })).toBeVisible();
    await expect(painel.getByRole('button', { name: /Auditoria\s*\(/ })).toHaveCount(0);

    // 5) Painel "Tipos no grafo" conta o mesmo que o SVG.
    const tipos = page.getByRole('region', { name: 'Tipos de entidade no grafo' });
    await expect(tipos.getByText('5 de no máximo 150 entidades no grafo.')).toBeVisible();

    await evidencia(page, 'e2e-03-grafo-inicial-alfa');
  });
});
