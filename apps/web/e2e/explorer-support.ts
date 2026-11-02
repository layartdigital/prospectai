import fs from 'node:fs';
import path from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import { DEMO, login } from './helpers';

/**
 * Suporte comum das specs E2E do Intelligence Explorer (P04-QA-04).
 *
 * Nada aqui simula a aplicacao: tudo opera o navegador real contra o Next, a
 * API e o PostgreSQL reais que o job do CI sobe. Os dados vem das fixtures
 * (`prisma/e2e-explorer-fixtures.ts`), lidas do manifesto que o proprio script
 * escreve — ids e nomes, nunca senhas.
 */

interface Entidade {
  id: string;
  name: string;
}

export interface Manifesto {
  alfa: {
    tenantId: string;
    email: string;
    hub: Entidade;
    satelites: Entidade[];
    removido: Entidade;
    notas: number;
    atividades: number;
    contatos: number;
    followUps: number;
    leadsNaPesquisa: number;
  };
  beta: {
    tenantId: string;
    email: string;
    hub: Entidade;
    segundo: Entidade;
    notas: number;
  };
}

let cache: Manifesto | null = null;

export function manifesto(): Manifesto {
  if (cache) return cache;
  const caminho =
    process.env.E2E_MANIFEST ?? path.resolve(process.cwd(), 'e2e/.generated/e2e-manifest.json');
  if (!fs.existsSync(caminho)) {
    throw new Error(
      `Manifesto das fixtures nao encontrado em ${caminho}. Rode "pnpm db:e2e-fixtures" antes do Playwright.`,
    );
  }
  cache = JSON.parse(fs.readFileSync(caminho, 'utf8')) as Manifesto;
  return cache;
}

export const ALFA = { email: DEMO.email, password: DEMO.password };

export function credenciaisBeta(): { email: string; password: string } {
  const password = process.env.E2E_BETA_PASSWORD ?? '';
  if (password.length < 12) throw new Error('E2E_BETA_PASSWORD ausente ou curta demais.');
  return { email: manifesto().beta.email, password };
}

/** Segundo usuario do MESMO workspace Alfa (papel SDR do seed). */
export function credenciaisSdr(): { email: string; password: string } {
  const password = process.env.SEED_SDR_PASSWORD ?? '';
  if (password.length < 12) throw new Error('SEED_SDR_PASSWORD ausente ou curta demais.');
  return { email: process.env.SEED_SDR_EMAIL ?? 'sdr@demo.propectai.local', password };
}

export type Quem = 'alfa' | 'beta' | 'sdr';

function credenciaisDe(quem: Quem): { email: string; password: string } {
  if (quem === 'alfa') return ALFA;
  if (quem === 'beta') return credenciaisBeta();
  return credenciaisSdr();
}

export const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export const refLead = (id: string): string => `LEAD:${id}`;

/** Entra pela tela de login, como uma pessoa. */
export async function entrarComo(page: Page, quem: Quem): Promise<void> {
  await login(page, credenciaisDe(quem));
}

/**
 * Troca o cookie de sessao da MESMA janela do navegador sem passar pela tela:
 * `page.request` compartilha o cookie jar do contexto, entao o `Set-Cookie` da
 * API substitui `pa_at`/`pa_rt` como aconteceria numa segunda aba. Nao dispara
 * `BroadcastChannel` — e exatamente o caso em que a aba antiga so descobre pelo
 * foco, pela visibilidade ou pelo polling.
 */
export async function trocarCookieDeSessaoPara(page: Page, quem: Quem): Promise<void> {
  const cred = credenciaisDe(quem);
  const resposta = await page.request.post('/api/v1/auth/login', { data: cred });
  expect(resposta.status(), 'login por API para trocar a sessao').toBeLessThan(300);
}

export type SinalDeRetorno = 'focus' | 'visibilitychange' | 'pageshow' | 'online';

/**
 * Dispara na pagina o evento que o navegador dispararia quando a pessoa volta
 * para a aba. Sao os mesmos eventos que o vigia de sessao escuta (`focus`,
 * `visibilitychange`, `pageshow`, `online`).
 */
export async function voltarParaAAba(page: Page, evento: SinalDeRetorno = 'focus'): Promise<void> {
  await page.evaluate((nome) => {
    if (nome === 'visibilitychange') document.dispatchEvent(new Event(nome));
    else window.dispatchEvent(new Event(nome));
  }, evento);
}

/**
 * Remove da pagina o relogio de 20 s do vigia de sessao (e qualquer outro
 * `setInterval` de 15 s ou mais), SEM tocar no codigo da aplicacao. Serve para
 * provar que o descarte dos dados vem dos eventos (login/logout em outra aba,
 * foco, visibilidade) e nao de a verificacao periodica ter calhado de rodar.
 * Chamar antes de qualquer navegacao da pagina.
 */
export async function desligarPollingLongo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
      ms !== undefined && ms >= 15_000 ? 0 : original(handler, ms, ...args)) as typeof window.setInterval;
  });
}

const PADRAO_DE_DADOS_DO_ALFA = /Alfa (Hub|Satelite|Removido)|Nota E2E Alfa/;

/**
 * Passa a observar o DOM: se, a partir de agora, qualquer texto de dado do Alfa
 * (nome de lead ou de nota das fixtures) aparecer na pagina, `houveVazamento`
 * devolve true — mesmo que o texto suma de novo no quadro seguinte.
 */
export async function armarVigiaDeVazamento(page: Page): Promise<void> {
  await page.evaluate((fonte) => {
    const padrao = new RegExp(fonte);
    const w = window as unknown as { __vazou?: boolean };
    w.__vazou = false;
    const olhar = (): void => {
      if (padrao.test(document.body.innerText)) w.__vazou = true;
    };
    new MutationObserver(olhar).observe(document.body, { childList: true, subtree: true, characterData: true });
    olhar();
  }, PADRAO_DE_DADOS_DO_ALFA.source);
}

export async function houveVazamento(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean((window as unknown as { __vazou?: boolean }).__vazou));
}

export { PADRAO_DE_DADOS_DO_ALFA };

export function grafo(page: Page): Locator {
  return page.locator('svg [data-no]');
}

export function no(page: Page, ref: string): Locator {
  return page.locator(`svg [data-no="${ref}"]`);
}

/** Todos os `data-no` do SVG, na ordem do DOM. */
export async function refsDoGrafo(page: Page): Promise<string[]> {
  return page.locator('svg [data-no]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-no') ?? ''),
  );
}

export function refsDoTipo(refs: string[], kind: string): string[] {
  return refs.filter((r) => r.startsWith(`${kind}:`));
}

export function semDuplicados(refs: string[]): boolean {
  return new Set(refs).size === refs.length;
}

export async function abrirExplorer(page: Page, leadId: string): Promise<void> {
  await page.goto(`/intelligence?lead=${encodeURIComponent(leadId)}`);
  await expect(no(page, refLead(leadId))).toBeVisible({ timeout: 60_000 });
}

export function painelDetalhes(page: Page): Locator {
  return page.getByRole('region', { name: 'Detalhes da entidade' });
}

/**
 * Seleciona um no pelo teclado (foco + Enter), que e o contrato de
 * acessibilidade do grafo. Evita depender do clique no centro de um circulo que
 * pode estar sob outro no num layout denso.
 */
export async function selecionarNo(page: Page, ref: string): Promise<void> {
  const alvo = no(page, ref);
  await expect(alvo).toBeAttached();
  await alvo.focus();
  await page.keyboard.press('Enter');
  await expect(alvo).toHaveAttribute('aria-pressed', 'true');
}

/** Botao "Carregar" de uma relacao no painel de detalhes (pelo rotulo do tipo). */
export function botaoDeRelacao(page: Page, rotulo: string): Locator {
  return painelDetalhes(page).getByRole('button', {
    name: new RegExp(`^${rotulo}\\s*\\(\\d+ de \\d+ no grafo\\)`),
  });
}

/**
 * Clica na relacao, espera a resposta 200 da API de expansao **e espera a tela
 * aplicar o resultado**: cada no devolvido pela API precisa estar no SVG antes
 * de a funcao retornar.
 *
 * (P04-QA-04R) A versao anterior parava na resposta HTTP. Entre o `200` e o
 * render do React ha um intervalo, e uma leitura do DOM nesse intervalo via zero
 * nos de `SCORE_REASON` embora a API tivesse devolvido oito. Agora o intervalo e
 * esperado pela condicao observavel (o no existir no DOM), sem pausa fixa. Se a
 * interface realmente perdesse os nos, esta espera estoura com a lista dos que
 * faltam — e isso aponta defeito do produto, nao do teste.
 *
 * Devolve as referencias que a API enviou nesta pagina.
 */
export async function carregarRelacao(page: Page, rotulo: string): Promise<string[]> {
  const botao = botaoDeRelacao(page, rotulo);
  await expect(botao).toBeEnabled();
  const [resposta] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/intelligence/expand') && r.request().method() === 'GET',
    ),
    botao.click(),
  ]);
  expect(resposta.status()).toBe(200);

  const corpo = (await resposta.json()) as { nodes: { ref: string }[] };
  const refs = corpo.nodes.map((n) => n.ref);
  for (const ref of refs) {
    await expect(no(page, ref), `a tela deve desenhar ${ref}, devolvido pela API`).toBeAttached();
  }
  return refs;
}

/** Percentual de zoom mostrado no canto do grafo. */
export async function zoomAtual(page: Page): Promise<number> {
  const texto = await page.getByText(/^\d+%$/).first().innerText();
  return Number(texto.replace('%', ''));
}

export function dirDeEvidencias(): string {
  const base =
    process.env.E2E_EVIDENCE_DIR ??
    path.resolve(process.cwd(), `${process.env.E2E_RESULTS_DIR ?? 'test-results-ci'}/evidencias`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/**
 * Captura de tela como evidencia. So da aplicacao com dados sinteticos: nenhuma
 * captura e tirada na tela de login com o formulario preenchido.
 */
export async function evidencia(page: Page, nome: string): Promise<void> {
  await page.screenshot({ path: path.join(dirDeEvidencias(), `${nome}.png`), fullPage: false });
}

/** Erros nao tratados da pagina (excecoes de JS), para provar console limpo. */
export function observarErrosDePagina(page: Page): string[] {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  return erros;
}

export interface NoDaApi {
  ref: string;
  kind: string;
  depth: number;
  depthProof?: string;
  label: string;
}

export interface GrafoDaApi {
  rootRef: string;
  nodes: NoDaApi[];
  edges: { id: string; source: string; target: string; verification: string; provenance: { kind: string } }[];
  omitted: Record<string, number>;
  limits: Record<string, number>;
}

/** Chama o grafo pela API real com a sessao do navegador. */
export async function grafoPelaApi(page: Page, leadId: string): Promise<{ status: number; corpo: string }> {
  const r = await page.request.get(`/api/v1/intelligence/graph?leadId=${encodeURIComponent(leadId)}`);
  return { status: r.status(), corpo: await r.text() };
}
