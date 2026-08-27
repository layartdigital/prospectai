import path from 'node:path';

import { type Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

import { comTenant } from '../src/db/com-tenant';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * `pnpm rls:bench` — quanto custa o `comTenant`, no banco de voces.
 *
 * O passo 3 do `PLANO-RLS-v1.md` existe para produzir este numero **antes** de
 * a politica entrar. Depois do passo 4 o custo do round trip e o custo do RLS
 * ficam somados, e nao ha mais como separa-los.
 *
 * A tentativa de tirar o numero da suite falhou: o `scrape-pipeline.spec.ts`,
 * que nem toca em `comTenant`, triplicou sozinho entre duas rodadas. Este
 * script existe porque medir sob ruido maior que o efeito nao e medir.
 *
 * ---
 *
 * **Tres decisoes de metodo, e as tres importam mais que o resultado:**
 *
 * 1. **Braco de controle.** Um dos bracos e identico ao basal, so com outro
 *    nome. A diferenca entre os dois **e o piso de ruido** desta maquina. Se o
 *    efeito medido nao for maior que ele, nao ha efeito medido — ha ruido com
 *    rotulo. Nenhuma outra linha deste relatorio pode ser lida antes desta.
 *
 * 2. **Bracos intercalados, nao em bloco.** Rodar 300 de A e depois 300 de B
 *    atribui ao tratamento qualquer coisa que tenha mudado na maquina no meio
 *    do caminho — outro processo, thermal throttling, autovacuum. Intercalando,
 *    a deriva atinge todos os bracos igualmente.
 *
 * 3. **p50 e p95, nao media.** Media esconde distribuicao bimodal, que e
 *    exatamente a forma que aparece quando o pool ora tem conexao livre ora
 *    espera por uma.
 *
 * ---
 *
 * **Tres bracos, para separar dois custos que costumam ser confundidos:**
 *
 *   solto      -> consulta direta, como antes do passo 3
 *   transacao  -> a mesma consulta dentro de `$transaction`, SEM `set_config`
 *   comTenant  -> transacao + `set_config`
 *
 * `transacao - solto` e o preco do `BEGIN`/`COMMIT`. `comTenant - transacao` e
 * o preco do `set_config`. Quem so compara a ponta a ponta atribui tudo ao
 * segundo, que e a parte barata.
 *
 * E duas formas de consulta, porque o custo aqui e **fixo por transacao**: numa
 * leitura por chave ele e quase tudo, numa lista de 50 ele se dilui. Os `+159%`
 * do spike sao de uma consulta barata, e citar esse numero para uma consulta
 * cara seria exagero.
 */

const ITERACOES = Number(process.env.RLS_BENCH_N ?? 300);
const AQUECIMENTO = 50;
const LEADS_FIXTURE = 120;

interface Braco {
  readonly nome: string;
  readonly executar: () => Promise<unknown>;
}

interface Resumo {
  readonly nome: string;
  readonly p50: number;
  readonly p95: number;
  readonly media: number;
}

function percentil(ordenado: number[], p: number): number {
  const i = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return ordenado[i] ?? 0;
}

function resumir(nome: string, amostras: number[]): Resumo {
  const ordenado = [...amostras].sort((a, b) => a - b);
  return {
    nome,
    p50: percentil(ordenado, 50),
    p95: percentil(ordenado, 95),
    media: amostras.reduce((s, v) => s + v, 0) / amostras.length,
  };
}

function ms(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

/** Intercala os bracos: um round-robin por iteracao, nao um bloco por braco. */
async function medir(bracos: readonly Braco[]): Promise<Resumo[]> {
  const amostras = new Map<string, number[]>(bracos.map((b) => [b.nome, []]));

  for (let i = 0; i < AQUECIMENTO; i += 1) {
    for (const braco of bracos) await braco.executar();
  }

  for (let i = 0; i < ITERACOES; i += 1) {
    for (const braco of bracos) {
      const t0 = process.hrtime.bigint();
      await braco.executar();
      amostras.get(braco.nome)?.push(ms(process.hrtime.bigint() - t0));
    }
  }

  return bracos.map((b) => resumir(b.nome, amostras.get(b.nome) ?? []));
}

function imprimir(titulo: string, resumos: readonly Resumo[]): void {
  const basal = resumos.find((r) => r.nome === 'solto');
  const controle = resumos.find((r) => r.nome === 'controle');
  const piso =
    basal && controle ? Math.abs((controle.p50 / basal.p50 - 1) * 100) : Number.NaN;

  console.log(`\n=== ${titulo} · ${ITERACOES} iteracoes ===`);
  console.log('braco        p50 (ms)   p95 (ms)   media     vs solto (p50)');
  for (const r of resumos) {
    const delta =
      basal && r.nome !== 'solto'
        ? `${((r.p50 / basal.p50 - 1) * 100).toFixed(1)}%`.padStart(8)
        : '       —';
    console.log(
      `${r.nome.padEnd(12)} ${r.p50.toFixed(3).padStart(8)} ${r.p95
        .toFixed(3)
        .padStart(10)} ${r.media.toFixed(3).padStart(9)}   ${delta}`,
    );
  }

  console.log(`\npiso de ruido (controle vs solto, ambos identicos): ${piso.toFixed(1)}%`);
  console.log(
    piso > 15
      ? '  ^ ALTO. Feche o que estiver rodando e repita: acima disso os numeros\n' +
          '    acima nao sustentam conclusao nenhuma.'
      : '  ^ efeito abaixo deste valor e ruido, nao custo.',
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const sufixo = Date.now().toString(36);
  let tenantId = '';

  try {
    const tenant = await prisma.tenant.create({
      data: { name: `Bench RLS ${sufixo}`, slug: `bench-rls-${sufixo}`, isDemo: true },
    });
    tenantId = tenant.id;

    await prisma.lead.createMany({
      data: Array.from({ length: LEADS_FIXTURE }, (_, i) => ({
        tenantId,
        name: `Lead bench ${i} ${sufixo}`,
        fingerprint: `bench-${sufixo}-${i}`,
      })),
    });

    const alvo = await prisma.lead.findFirstOrThrow({
      where: { tenantId },
      select: { id: true },
    });

    console.log(`tenant descartavel: ${tenantId} · ${LEADS_FIXTURE} leads`);

    // --- forma 1: leitura por chave, o caso mais barato que existe ---
    // `Prisma.TransactionClient` aceita tanto o client inteiro quanto o `tx`,
    // que e o que permite rodar a MESMA consulta nos quatro bracos. Consulta
    // reescrita por braco mediria a reescrita.
    const porChave = (tx: Prisma.TransactionClient): Promise<unknown> =>
      tx.lead.findUnique({
        where: { tenantId_id: { tenantId, id: alvo.id } },
        select: { id: true, name: true },
      });

    imprimir(
      'leitura por chave',
      await medir([
        { nome: 'solto', executar: () => porChave(prisma) },
        { nome: 'controle', executar: () => porChave(prisma) },
        { nome: 'transacao', executar: () => prisma.$transaction((tx) => porChave(tx)) },
        { nome: 'comTenant', executar: () => comTenant(prisma, tenantId, (tx) => porChave(tx)) },
      ]),
    );

    // --- forma 2: lista de 50, onde o custo fixo se dilui ---
    const lista = (tx: Prisma.TransactionClient): Promise<unknown> =>
      tx.lead.findMany({ where: { tenantId }, take: 50, select: { id: true, name: true } });

    imprimir(
      'lista de 50',
      await medir([
        { nome: 'solto', executar: () => lista(prisma) },
        { nome: 'controle', executar: () => lista(prisma) },
        { nome: 'transacao', executar: () => prisma.$transaction((tx) => lista(tx)) },
        { nome: 'comTenant', executar: () => comTenant(prisma, tenantId, (tx) => lista(tx)) },
      ]),
    );

    // --- forma 3: doze consultas independentes, como o dashboard faz ---
    //
    // **Esta e a forma que a regra de escopo do passo 3 nao previu.**
    //
    // Aquela regra — "envolva o escopo mais amplo, o custo e por chamada" —
    // saiu de um benchmark que media consulta a consulta. Ela ignora que uma
    // transacao do Prisma roda tudo numa conexao so: envolver doze consultas
    // paralelas num `comTenant` **serializa as doze**.
    //
    // O `dashboard.service.ts` faz exatamente isso, com doze. Os tres bracos
    // abaixo medem as tres formas de escrever a mesma tela:
    //
    //   solto        as doze em paralelo, sem contexto (como hoje)
    //   um_bloco     as doze dentro de UM comTenant  -> 1x overhead, serial
    //   doze_blocos  doze comTenant em paralelo      -> 12x overhead, paralelo
    //
    // Nao ha resposta obvia, e e por isso que ela e medida em vez de deduzida.
    const doze = <T>(f: (tx: Prisma.TransactionClient) => Promise<T>) =>
      Array.from({ length: 12 }, () => f);

    const consulta = (tx: Prisma.TransactionClient): Promise<unknown> =>
      tx.lead.count({ where: { tenantId } });

    imprimir(
      'doze consultas independentes',
      await medir([
        {
          nome: 'solto',
          executar: () => Promise.all(doze(consulta).map((f) => f(prisma))),
        },
        {
          nome: 'controle',
          executar: () => Promise.all(doze(consulta).map((f) => f(prisma))),
        },
        {
          nome: 'um_bloco',
          executar: () =>
            comTenant(prisma, tenantId, (tx) =>
              Promise.all(doze(consulta).map((f) => f(tx))),
            ),
        },
        {
          nome: 'doze_blocos',
          executar: () =>
            Promise.all(
              doze(consulta).map((f) => comTenant(prisma, tenantId, (tx) => f(tx))),
            ),
        },
      ]),
    );

    console.log(
      '\nRLS esta DESLIGADO nesta medicao. O que se ve aqui e so o custo da\n' +
        'transacao e do set_config — o custo da politica vem no passo 4, e so\n' +
        'da para separar os dois porque este numero foi tirado antes.\n' +
        '\nNa terceira forma, repare no pool: `doze_blocos` abre doze transacoes\n' +
        'simultaneas. Se ele for o mais rapido, o numero e verdadeiro e o custo\n' +
        'aparece em outro lugar — com varios usuarios ao mesmo tempo, nao com um.',
    );
  } finally {
    // O `finally` e a razao do `audit:e2e` existir. Mesma regra: terminar
    // inclui terminar mal, senao a primeira falha deixa 120 leads orfaos e o
    // `business-invariants.spec.ts` cobra na proxima rodada.
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch((e: unknown) => {
        console.error(`FALHA AO LIMPAR o tenant ${tenantId}:`, e);
      });
    }
    await prisma.$disconnect();
  }
}

void main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
