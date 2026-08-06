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
 * Valor de um card de KPI.
 *
 * O rótulo aparece em MAIÚSCULAS na tela, mas por CSS (`uppercase`) — no DOM o
 * texto é "Leads encontrados". Buscar pelo que se vê renderizado é a armadilha
 * clássica aqui, e o erro que ela produz ("recebido: Leads encontrados") não
 * sugere a causa.
 *
 * O valor mora num <p> irmão do rótulo, não dentro dele: filtrar o card
 * inteiro e descer até o número é o caminho estável.
 */
export function kpiValue(page: Page, rotulo: string) {
  return page
    .locator('div.pa-card')
    .filter({ hasText: new RegExp(rotulo, 'i') })
    .locator('p.text-kpi')
    .first();
}

/** Sufixo estável por execução, para não colidir entre rodadas. */
export const runId = Date.now().toString(36);
