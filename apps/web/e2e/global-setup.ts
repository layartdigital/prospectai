import { chromium, expect, type FullConfig } from '@playwright/test';

/**
 * Aquecimento das rotas.
 *
 * O Next em modo dev compila cada rota na primeira visita. A primeira carga
 * levou mais de um minuto numa execução real, e o custo aparecia disfarçado de
 * falha de teste — `waitForURL` estourando enquanto a rota compilava.
 *
 * Diagnóstico errado é o dano: "login não redireciona" parece defeito de
 * autenticação e manda alguém investigar o guard, quando o problema é o
 * bundler.
 *
 * A primeira versão deste arquivo visitava as rotas SEM sessão — e não
 * funcionou: o middleware devolve para /login antes de o Next compilar o
 * segmento protegido. O aquecimento parecia acontecer e não acontecia. Por
 * isso agora autentica primeiro.
 *
 * Contra `next build && next start`, que eliminaria a latência de vez: o build
 * custa mais que o aquecimento e tira o hot reload de quem desenvolve. Vale
 * reavaliar quando houver CI.
 */

const PUBLICAS = ['/login', '/register'];

const PROTEGIDAS = [
  '/dashboard',
  '/leads',
  '/pipeline',
  '/history',
  '/search',
  '/settings',
  '/subscription',
  '/notifications',
];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.E2E_BASE_URL ??
    'http://localhost:3100';

  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.propectai.local';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Demo@123456';

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const visitar = async (rota: string): Promise<void> => {
    await page
      .goto(`${baseURL}${rota}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
      .catch(() => {
        // Falha no aquecimento não derruba a suíte: o teste que depender da
        // rota falha depois com mensagem própria, que é mais informativa.
      });
  };

  for (const rota of PUBLICAS) await visitar(rota);

  // Diagnóstico do login.
  //
  // Um `waitForURL` que estoura diz apenas "esperei" — e a causa pode ser
  // credencial errada, API fora do ar ou hidratação travada, três
  // investigações completamente diferentes. Vale capturar o motivo real.
  const errosDeConsole: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errosDeConsole.push(msg.text());
  });

  // Exceção não capturada não aparece como console.error.
  page.on('pageerror', (erro) => errosDeConsole.push(`pageerror: ${erro.message}`));

  // A resposta do endpoint de login é o dado que separa "não enviou",
  // "enviou e falhou" e "enviou, deu certo e não navegou" — três causas com
  // investigações opostas.
  const respostasDeLogin: string[] = [];
  page.on('response', (res) => {
    if (!res.url().includes('/auth/login')) return;

    void res
      .text()
      .then((corpo) =>
        respostasDeLogin.push(`${res.status()} ${corpo.slice(0, 300)}`),
      )
      .catch(() => respostasDeLogin.push(`${res.status()} (corpo ilegível)`));
  });

  const requisicoesDeLogin: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/auth/login')) {
      requisicoesDeLogin.push(`${req.method()} ${req.url()} :: ${req.postData() ?? ''}`);
    }
  });

  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

  const botao = page.getByRole('button', { name: 'Entrar' });

  // Esperar ANTES de preencher, não depois.
  //
  // Input controlado do React descarta o que foi escrito antes da hidratação:
  // o `fill` grava no DOM, mas sem `onChange` o estado continua vazio e a
  // hidratação re-renderiza por cima. O submit sai em branco e a API responde
  // 400 — que parece credencial inválida e não é. Foi o que aconteceu aqui em
  // 31/07/2026, porque `domcontentloaded` é anterior à hidratação.
  await expect(botao).toBeEnabled({ timeout: 120_000 });

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await botao.click();

  const alerta = page.getByRole('alert');

  // Espera direta, sem corrida.
  //
  // A versão anterior corria `waitForURL` contra "apareceu um alerta", para
  // falhar rápido em caso de erro. Não funciona: a página tem um elemento com
  // role="alert" sem texto — região aria-live vazia — que já está visível, e
  // condição já verdadeira vence a corrida em milissegundos. O resultado era
  // conferir a URL antes de o router.push completar, e reportar falha num
  // login que respondera 200.
  //
  // Lição: `Promise.race` com espera por elemento só funciona se o elemento
  // comprovadamente não existir antes da ação.
  await page
    .waitForURL(/\/(dashboard|onboarding)/, { timeout: 120_000 })
    .catch(() => undefined);

  if (!/\/(dashboard|onboarding)/.test(page.url())) {
    // Dar tempo de a resposta pendente ser lida antes de montar o relatório.
    await page.waitForTimeout(1000);

    const alertas = await alerta.allTextContents().catch(() => []);
    const valorEmail = await page
      .getByLabel('E-mail')
      .inputValue()
      .catch(() => '(ilegível)');

    throw new Error(
      [
        'Aquecimento falhou: o login não completou.',
        `URL atual: ${page.url()}`,
        `Campo e-mail no momento do clique: "${valorEmail}"`,
        `Alertas na tela: ${alertas.filter((t) => t.trim()).join(' | ') || '(nenhum com texto)'}`,
        `Requisições a /auth/login: ${requisicoesDeLogin.join(' | ') || '(NENHUMA — o handler não disparou)'}`,
        `Respostas de /auth/login: ${respostasDeLogin.join(' | ') || '(nenhuma)'}`,
        `Erros de console: ${errosDeConsole.join(' | ') || '(nenhum)'}`,
        `Credenciais usadas: ${email}`,
      ].join('\n'),
    );
  }

  for (const rota of PROTEGIDAS) await visitar(rota);

  // A ficha do lead é segmento dinâmico e compila em separado do /leads.
  await page.goto(`${baseURL}/leads`, { waitUntil: 'domcontentloaded' });
  const primeiroLead = page.getByRole('row').nth(1).getByRole('link').first();
  if (await primeiroLead.count()) {
    await primeiroLead.click().catch(() => undefined);
    await page.waitForURL(/\/leads\/[^/]+$/, { timeout: 180_000 }).catch(() => undefined);
  }

  await browser.close();
}
