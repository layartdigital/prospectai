import { execSync } from 'node:child_process';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DEMO, login } from './helpers';

/**
 * Fluxo crítico 4 — feature gates nos quatro planos (critério 19).
 *
 * Duas afirmações independentes, e as duas precisam valer:
 *
 *   1. Nenhum modal de bloqueio abre ao carregar página. Em nenhum plano, em
 *      nenhuma tela.
 *   2. O gate muda de comportamento entre os planos. Um produto onde tudo
 *      passa em qualquer plano também satisfaz a afirmação 1 — e está errado.
 *
 * A segunda existe porque a primeira, sozinha, é fácil de passar por acidente.
 *
 * Nota de arquitetura: o produto não tem `role="dialog"` em lugar nenhum. O
 * bloqueio é um bloco contextualizado onde o resultado apareceria, com link
 * para os planos — ver comentário em `lead-outreach-card.tsx`. A asserção de
 * ausência de modal é portanto uma trava de regressão contra alguém introduzir
 * um: barata de manter, e protege a regra que o escopo chama de razão de
 * existir do produto.
 *
 * Precisa de `pnpm db:seed` — só age em tenants com `isDemo: true`.
 */

const RAIZ = path.resolve(__dirname, '../../..');

type Plano = 'free' | 'start' | 'pro' | 'agency';

/**
 * Troca o plano do tenant de demonstração pelo mesmo CLI que a pessoa usa.
 *
 * `execSync` com comando em string, e não `execFileSync` com vetor de
 * argumentos. As duas alternativas óbvias falham no Windows:
 *
 *   - `execFileSync('pnpm', [...], { shell: true })` funciona, mas dispara
 *     DEP0190: argumentos concatenados sem escape.
 *   - `execFileSync('pnpm.cmd', [...])` sem shell falha com EINVAL. O Node 20+
 *     recusa executar `.cmd` e `.bat` diretamente, por segurança.
 *
 * `execSync` recebe a linha inteira e é a API pensada para uso com shell.
 * Injeção não é risco aqui: `plano` vem de um union de literais, não de
 * entrada externa.
 */
function trocarPlano(plano: Plano): void {
  execSync(`pnpm db:plan ${plano} --reset`, { cwd: RAIZ, stdio: 'pipe' });
}

/** Telas que qualquer plano pode abrir. Nenhuma delas pode disparar modal. */
const TELAS = ['/dashboard', '/leads', '/pipeline', '/search', '/history', '/settings'];

async function abrirPrimeiroLead(page: Page): Promise<void> {
  await page.goto('/leads');
  const link = page.getByRole('row').nth(1).getByRole('link').first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/leads\/[^/]+$/, { timeout: 60_000 });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  // Devolve o ambiente ao estado do seed. Teste que deixa o banco num plano
  // diferente do inicial faz o próximo desenvolvedor perseguir um fantasma.
  trocarPlano('free');
});

for (const plano of ['free', 'start', 'pro', 'agency'] as const) {
  test.describe(`plano ${plano.toUpperCase()}`, () => {
    test('nenhuma tela dispara modal de bloqueio ao carregar', async ({ page }) => {
      trocarPlano(plano);
      // Login novo a cada plano: a sessão carrega o plano vigente, e reaproveitar
      // a anterior testaria o plano errado.
      await login(page);

      for (const tela of TELAS) {
        await page.goto(tela);
        await expect(
          page.getByRole('dialog'),
          `${tela} abriu modal sem ação do usuário no plano ${plano}`,
        ).toHaveCount(0);
      }

      await abrirPrimeiroLead(page);
      await expect(
        page.getByRole('dialog'),
        `a ficha do lead abriu modal sem ação do usuário no plano ${plano}`,
      ).toHaveCount(0);
    });
  });
}

test.describe('o gate muda entre os planos', () => {
  test('FREE mascara o telefone; PRO não', async ({ page }) => {
    trocarPlano('free');
    await login(page);
    await page.goto('/leads');

    // Aviso informativo, não bloqueio: explica o que está oculto e por quê.
    // Aparecer ao carregar é correto — o que não pode é interromper.
    await expect(page.getByText(/parcialmente ocultos/i)).toBeVisible();

    trocarPlano('pro');
    await login(page);
    await page.goto('/leads');

    await expect(page.getByText(/parcialmente ocultos/i)).toHaveCount(0);
  });

  test('no FREE o bloqueio da IA só aparece depois do clique', async ({ page }) => {
    trocarPlano('free');
    await login(page);
    await abrirPrimeiroLead(page);

    // FREE tem aiGenerationsPerMonth: 0. Mesmo assim o card aparece
    // contextualizado, e nada bloqueia até a pessoa tentar.
    const verPlanos = page.getByRole('link', { name: 'Ver planos' });
    await expect(verPlanos).toHaveCount(0);

    await page.getByRole('button', { name: /Gerar abordagem|Regenerar/ }).click();

    // Agora sim: bloqueio no lugar do resultado, com caminho para o upgrade.
    await expect(verPlanos.first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('no AGENCY a mesma ação gera em vez de bloquear', async ({ page }) => {
    trocarPlano('agency');
    await login(page);
    await abrirPrimeiroLead(page);

    await page.getByRole('button', { name: /Gerar abordagem|Regenerar/ }).click();

    // O contraponto do teste anterior: sem ele, "bloqueou" e "quebrou"
    // produzem o mesmo resultado visível.
    await expect(page.getByLabel(/Mensagem gerada/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Ver planos' })).toHaveCount(0);
  });
});

/**
 * A vitrine — o que a tela de planos promete.
 *
 * Os testes acima provam que o gate se comporta diferente por plano. Este
 * prova algo anterior, e que faltava: **que a diferença está escrita onde a
 * pessoa decide pagar.**
 *
 * Até 17/09/2026 nenhum dos quatro cards dizia quantos diagnósticos o plano
 * inclui. Dois dias antes o FREE havia caído de três auditorias por mês para
 * uma, exatamente para pôr o alvo do Gate 1 atrás do pagamento — e a tela não
 * contava. Um limite que o banco aplica e a vitrine omite vira restrição
 * sentida como defeito, em vez de razão para assinar.
 *
 * Um único carregamento cobre os quatro planos: `/subscription` lista todos.
 */
test.describe('a vitrine de planos', () => {
  test('cada card diz quantos diagnósticos inclui, e os números diferem', async ({
    page,
  }) => {
    trocarPlano('free');
    await login(page);
    await page.goto('/subscription');

    // O botão de cada card serve de contador: um por plano, seja qual for o
    // número de planos no banco. Fixar `4` aqui faria o teste quebrar no dia
    // em que um quinto plano existisse — e quebrar pelo motivo errado.
    const botoes = page.getByRole('button', {
      name: /Falar sobre este plano|Seu plano atual/,
    });
    await expect(botoes.first()).toBeVisible();

    const linhas = page.getByRole('listitem').filter({ hasText: /de presença digital/ });
    await expect(
      linhas,
      'algum card de plano não diz quantos diagnósticos inclui',
    ).toHaveCount(await botoes.count());

    const textos = (await linhas.allTextContents()).map((t) => t.trim());

    // O FREE com **um** diagnóstico é o fato comercial do Gate 1, e está aqui
    // à mão de propósito: se alguém devolver o FREE para três, isto quebra e
    // obriga a decisão a ser escrita em vez de acontecer.
    expect(textos).toContain('1 diagnóstico de presença digital');

    // E os planos precisam diferir entre si. Quatro cards dizendo o mesmo
    // número passariam na asserção acima e não venderiam nada.
    expect(new Set(textos).size).toBeGreaterThan(1);
  });
});
