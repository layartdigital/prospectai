import { expect, type Page } from '@playwright/test';

/**
 * Credenciais do seed. Ficam em variável de ambiente porque o seed as lê de
 * lá — fixar aqui criaria duas fontes de verdade que divergem na primeira vez
 * que alguém trocar a senha de demonstração.
 */
export const DEMO = {
  email: process.env.SEED_OWNER_EMAIL ?? 'owner@demo.propectai.local',
  password: process.env.SEED_OWNER_PASSWORD ?? 'Demo@123456',
};

/**
 * Autentica e espera a sessão existir de fato.
 *
 * Esperar por URL é obrigatório: seguir direto para `page.goto` de rota
 * protegida sem isso faz o middleware devolver para /login, e a falha aparece
 * como "elemento não encontrado" na tela seguinte — sintoma três passos
 * distante da causa.
 *
 * Aceita /dashboard ou /onboarding porque conta recém-criada vai para o wizard.
 */
export async function login(page: Page, credentials = DEMO): Promise<void> {
  // Sessão anterior é limpa sempre, não só quando parece necessário.
  //
  // Chamar `login()` duas vezes no mesmo teste — trocar de plano, entrar com
  // outra conta — levava o middleware a redirecionar o usuário já autenticado
  // para o dashboard, e o botão "Entrar" nunca aparecia. O erro dizia
  // "elemento não encontrado", que manda investigar o formulário.
  //
  // Nos fluxos 1 a 3 nunca apareceu porque cada teste ganha contexto novo. Era
  // pré-condição acidental; aqui virou explícita.
  await page.context().clearCookies();

  await page.goto('/login');
  await aguardarHidratacao(page, 'Entrar');

  await page.getByLabel('E-mail').fill(credentials.email);
  await page.getByLabel('Senha').fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 60_000 });
}

/**
 * Espera o formulário estar vivo antes de digitar.
 *
 * Input controlado do React descarta o que foi escrito antes da hidratação: o
 * `fill` grava no DOM, mas sem `onChange` o estado continua vazio, e a
 * hidratação re-renderiza por cima. O submit sai com os campos em branco e a
 * API responde 400 — erro que parece credencial inválida e não é.
 *
 * O botão desabilitado até hidratar (a trava contra submit nativo) é o sinal
 * confiável de que o React assumiu o formulário.
 */
export async function aguardarHidratacao(page: Page, botao: string): Promise<void> {
  await expect(page.getByRole('button', { name: botao })).toBeEnabled({
    timeout: 60_000,
  });
}

/** Navega por link e espera a rota trocar, tolerando compilação sob demanda. */
export async function irPara(page: Page, nome: string, url: RegExp): Promise<void> {
  await page.getByRole('link', { name: nome }).click();
  await page.waitForURL(url, { timeout: 60_000 });
}

/**
 * Valor de um card de KPI, pelo contrato de teste do componente.
 *
 * A versão anterior usava `div.pa-card` + `p.text-kpi` e quebrou na migração de
 * 06/08/2026 com "element(s) not found". Classe de estilo é contrato acidental:
 * o `cn()` do KpiCard passa por tailwind-merge, que pode descartar `text-kpi`
 * por conflito de grupo com `text-navy-900` — o seletor some sem ninguém tocar
 * no componente, e o erro não sugere a causa.
 *
 * `data-kpi-label` também evita a armadilha do rótulo: ele aparece em
 * MAIÚSCULAS na tela por CSS, mas no DOM é "Leads encontrados".
 */
export function kpiValue(page: Page, rotulo: string) {
  return page
    .locator(`[data-testid="kpi-card"][data-kpi-label="${rotulo}"]`)
    .locator('[data-testid="kpi-value"]')
    .first();
}

/** Sufixo estável por execução, para não colidir entre rodadas. */
export const runId = Date.now().toString(36);
