import { createHash } from 'node:crypto';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Auditoria de ponta a ponta, contra a pilha rodando.
 *
 * `pnpm audit:e2e [site]`
 *
 * Atravessa o caminho inteiro — API, BullMQ, worker, provider, banco — que
 * nenhum teste atravessa: o `audits-http.spec.ts` para na fronteira da fila, e
 * o `audit-pipeline.spec.ts` chama o pipeline direto, sem BullMQ no meio.
 *
 * **Exige `pnpm dev` no ar.** Sem API e worker nao ha o que exercitar.
 *
 * ---
 *
 * **A limpeza fica no `finally`, e essa e a razao deste arquivo existir.**
 *
 * A versao manual disto era uma sequencia de comandos colada no terminal. Ela
 * mandava apagar o arquivo `.sql` e esquecia de apagar o *dado* — e o lead
 * inserido por SQL cru, sem passar pelo pipeline de score, virou orfao e
 * quebrou o `business-invariants.spec.ts`, que varre o banco inteiro atras
 * exatamente disso.
 *
 * O banco e compartilhado com a suite. **Procedimento manual contra banco
 * compartilhado precisa terminar com limpeza** — e "terminar" inclui terminar
 * mal, senao a primeira falha deixa o rastro que a proxima execucao vai
 * herdar.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3101';
const ROTA = `${BASE}/api/v1`;

const TERMINAIS = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
const ESPERA_MAX_MS = 60_000;
const INTERVALO_MS = 1_000;

interface Checagem {
  check: string;
  outcome: string;
  observedUrl: string | null;
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

interface Auditoria {
  auditId: string;
  status: string;
  providerName: string | null;
  durationMs: number | null;
  errorCode: string | null;
  checks: Checagem[];
}

function cookies(resposta: Response): string {
  return resposta.headers
    .getSetCookie()
    .map((bruto) => bruto.split(';')[0])
    .filter((par): par is string => Boolean(par))
    .join('; ');
}

async function esperarApi(): Promise<void> {
  try {
    // Qualquer resposta serve — inclusive 401 ou 404. O que se quer saber e se
    // ha alguem escutando, nao se a rota existe.
    await fetch(`${ROTA}/audits/quota`);
  } catch {
    throw new Error(`API não responde em ${BASE}. Suba com "pnpm dev" antes.`);
  }
}

async function main(): Promise<void> {
  const site = process.argv[2] ?? 'https://layart.com.br';
  const marca = Date.now().toString(36);
  const email = `e2e-${marca}@teste.propectai.local`;

  await esperarApi();

  const prisma = new PrismaClient();
  let tenantId = '';

  try {
    const registro = await fetch(`${ROTA}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Verificação E2E',
        tenantName: `E2E ${marca}`,
        email,
        password: 'SenhaDeTeste123',
      }),
    });

    if (registro.status !== 201) {
      throw new Error(`registro falhou: ${registro.status} ${await registro.text()}`);
    }

    const sessao = (await registro.json()) as { tenant: { id: string } | null };
    const cookie = cookies(registro);
    tenantId = sessao.tenant?.id ?? '';
    if (tenantId === '') throw new Error('registro não devolveu tenant');

    const lead = await prisma.lead.create({
      data: {
        tenantId,
        name: `Alvo E2E ${marca}`,
        website: site,
        fingerprint: createHash('sha256').update(`e2e-${marca}`).digest('hex'),
      },
    });

    console.log(`\nalvo    ${site}`);
    console.log(`tenant  ${tenantId}  (descartável)`);

    const pedido = await fetch(`${ROTA}/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ leadId: lead.id }),
    });

    if (pedido.status !== 201) {
      throw new Error(`pedido falhou: ${pedido.status} ${await pedido.text()}`);
    }

    const criada = (await pedido.json()) as { auditId: string; reaproveitada: boolean };
    console.log(`audit   ${criada.auditId}\n`);

    const inicio = Date.now();
    let atual: Auditoria | null = null;

    while (Date.now() - inicio < ESPERA_MAX_MS) {
      const leitura = await fetch(`${ROTA}/audits/${criada.auditId}`, { headers: { Cookie: cookie } });
      atual = (await leitura.json()) as Auditoria;
      if (TERMINAIS.has(atual.status)) break;
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }

    if (atual === null || !TERMINAIS.has(atual.status)) {
      // **Nao terminar e o achado.** O worker pode estar fora do ar, a fila com
      // nome divergente, ou o job preso — e todos os tres saem daqui como
      // "ficou em QUEUED", que e a informacao que interessa.
      console.log(`NÃO TERMINOU em ${ESPERA_MAX_MS / 1000}s — estado ${atual?.status ?? '?'}`);
      console.log('O worker está no ar? A fila do worker e a da API têm o mesmo nome e prefixo?');
      process.exitCode = 1;
      return;
    }

    // **O provider vem antes do resultado, e nao por estetica.** Ler a medicao
    // sem saber quem a produziu ja custou tres enganos: auditorias do mock
    // passaram por reais porque ninguem reparou no `durationMs`.
    console.log(
      `=== ${atual.status} em ${atual.durationMs ?? '?'}ms · provider: ${atual.providerName ?? '?'} ===`,
    );
    if (atual.providerName === 'mock') {
      console.log('  ATENÇÃO: isto é o mock. Nada aqui foi medido contra a internet.');
      console.log('  Defina SITE_AUDIT_PROVIDER=native no .env e reinicie o worker.');
    }
    if (atual.errorCode !== null) console.log(`  erro: ${atual.errorCode}`);

    for (const c of atual.checks) {
      console.log(
        [
          ' ',
          c.check.padEnd(15),
          c.outcome.padEnd(8),
          (c.errorCode ?? '').padEnd(26),
          JSON.stringify(c.result ?? {}),
          c.observedUrl ?? '',
        ].join(' '),
      );
    }

    if (atual.checks.length === 0) {
      console.log('  (nenhuma checagem gravada)');
    }
  } finally {
    // Cascade leva lead, auditoria, checagens, plan_usage e membership.
    if (tenantId !== '') {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log('\nlimpo.');
  }
}

/**
 * O que olhar, e nao e o "COMPLETED".
 *
 * - O `provider` no cabecalho diz quem mediu. `mock` significa que nada ali
 *   veio da internet, e o script avisa em voz alta. Antes deste campo, a unica
 *   pista era o `durationMs` baixo — e ela passou despercebida tres vezes.
 * - `forcaHttps` ausente em `REDIRECT_CHAIN` significa sonda http nao
 *   conclusiva. Em todos os alvos, suspeite de intermediario na sua rede.
 * - Auditoria presa em `QUEUED` e worker fora do ar ou fila divergente.
 */
main().catch((erro: unknown) => {
  console.error('e2e falhou:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
