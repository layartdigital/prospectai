import path from 'node:path';

import type { LeadSourceProvider, RawLead } from '@propectai/types';
import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaApp } from '../src/db/prisma-app';
import { MockLeadSourceProvider } from '../src/providers/mock.provider';
import { processScrapeJob } from '../src/pipeline/process-scrape-job';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Regras comerciais 5.3 e 5.4 do escopo — prova de COMPORTAMENTO.
 *
 * Complementa business-invariants.spec.ts na API, que varre o estado do banco.
 * Aquele é rede permanente e passa trivialmente em banco vazio; este roda o
 * ciclo de verdade: mesma busca duas vezes, e uma falha forçada.
 *
 * O que se prova aqui:
 *   - lead novo consome cota, duplicado não
 *   - job que falha devolve toda a reserva
 *   - nenhum lead de job concluído fica sem score e sem motivo
 *
 * ---
 *
 * **Dois clientes, e a separação é o que dá sentido ao verde.**
 *
 * `admin` monta o cenário e confere o resultado, com o papel que ignora a
 * política. Montar cenário é operação administrativa: não faz sentido submetê-la
 * à política que se quer testar.
 *
 * `prisma` é o que o código sob teste recebe — `criarPrismaApp()`, conectado
 * pelo `DATABASE_URL_APP` e portanto **sujeito à política**. É o mesmo par do
 * `audit-pipeline.spec.ts`.
 *
 * Até 03/09 este era o único spec do worker com um cliente só, e ele era o
 * cliente do dono. Não quebrava nada — não há política sobre as tabelas de lead
 * ainda. **O que estava em risco era o significado do verde:** ligada a família
 * Leads na fase B, esta suíte — que prova cota, deduplicação e score — rodaria
 * por fora da política e passaria sem ela no caminho. Passaria provando menos
 * do que diz provar, e nada indicaria isso.
 *
 * É exatamente o cenário para o qual o aviso alto do `criarPrismaApp` foi
 * escrito.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const admin = criarPrismaAdmin();
const prisma = criarPrismaApp();
const suffix = Date.now().toString(36);

/**
 * As unicas chaves que podem chegar ao `LeadSourceRecord.payload`.
 *
 * O tipo `Record<keyof RawLead, true>` e o ponto do desenho, e nao enfeite:
 * se alguem acrescentar um campo a `RawLead` e esquecer de acrescenta-lo
 * aqui, **o `typecheck` reprova**. A lista deixa de ser copia a mao da
 * interface e passa a ser derivada dela em tempo de compilacao.
 *
 * Isso importa porque a linha que grava e
 * `payload: raw as unknown as Prisma.InputJsonValue`, e `as unknown as`
 * desliga a checagem de tipo. Do lado do banco, o que protegia a regra 6 era
 * convencao mais comentario: o `toRawLead` do provider monta o objeto campo a
 * campo, sem espalhamento. No dia em que alguem escrever
 * `return { ...entry, title: ... }` — que e a forma natural de escrever isso —
 * o compilador nao reclama, porque tipo nao remove chave em tempo de
 * execucao, e o dado pessoal passa a ser persistido em silencio.
 *
 * Sao 21 campos.
 */
const CHAVES_DE_RAWLEAD: Record<keyof RawLead, true> = {
  title: true,
  category: true,
  phone: true,
  email: true,
  website: true,
  addressFull: true,
  street: true,
  neighborhood: true,
  city: true,
  stateName: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  reviewCount: true,
  reviewRating: true,
  openHours: true,
  timezone: true,
  placeId: true,
  cid: true,
  sourceUrl: true,
  status: true,
};

/**
 * `Set` e nao o objeto acima, e a diferenca nao e estetica.
 *
 * `'toString' in CHAVES_DE_RAWLEAD` e `true` — a busca com `in` sobe pela
 * cadeia de prototipos. Um payload com chave chamada `toString`,
 * `constructor` ou `valueOf` passaria pela conferencia sem ser vista.
 */
const AUTORIZADAS = new Set(Object.keys(CHAVES_DE_RAWLEAD));

const REQUESTED = 10;

/**
 * Pedido que faz o mock devolver mais de um resultado.
 *
 * `maxDepth` sai de `ceil(requestedCount / 20)` e o mock trata profundidade
 * como quantidade — 10 pedidos viram 1 lead. Para exercitar o limiar de
 * validação é preciso passar do primeiro múltiplo: 100 devolve 5.
 */
const REQUESTED_LARGO = 100;
const RESULTADOS_LARGO = 5;

let tenantId = '';
let searchId = '';
let segmentId = '';

/** Mesma definição de período usada pelo pipeline: 1º do mês, hora local. */
function periodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function usage(): Promise<{ reserved: number; settled: number }> {
  const row = await admin.planUsage.findUniqueOrThrow({
    where: { tenantId_periodStart: { tenantId, periodStart: periodStart() } },
  });
  return { reserved: row.leadsReserved, settled: row.leadsSettled };
}

/** Reserva a cota como a API faz ao enfileirar, e cria o job correspondente. */
async function enqueue(
  label: string,
  count = REQUESTED,
  alvo = searchId,
): Promise<string> {
  await admin.planUsage.update({
    where: { tenantId_periodStart: { tenantId, periodStart: periodStart() } },
    data: { leadsReserved: { increment: count }, searchesCount: { increment: 1 } },
  });

  const job = await admin.scrapeJob.create({
    data: {
      tenantId,
      searchId: alvo,
      keyword: 'Dentistas em São Paulo, SP',
      idempotencyKey: `${suffix}-${label}`,
      status: 'QUEUED',
    },
  });

  return job.id;
}

function payload(scrapeJobId: string, count = REQUESTED, alvo = searchId) {
  return {
    tenantId,
    searchId: alvo,
    scrapeJobId,
    // Mesma palavra-chave em todos os jobs de propósito: o mock gera títulos
    // determinísticos a partir dela, e é isso que faz a deduplicação por
    // fingerprint acontecer entre execuções.
    keyword: 'Dentistas em São Paulo, SP',
    requestedCount: count,
    radiusKm: 10,
  };
}

/**
 * Cria um locale de teste com o status pedido.
 *
 * Locale inventado (`xx-*`, país `XX`) para não colidir com dado real nem com
 * outra execução da suíte — a chave é única por segmento e idioma.
 */
async function criarLocale(
  status: 'GERADO' | 'VALIDADO' | 'CURADO',
  chave: string,
): Promise<string> {
  const locale = await admin.segmentLocale.create({
    data: {
      segmentId,
      locale: `xx-${chave}`,
      country: 'XX',
      label: 'Dentistas',
      searchTerms: ['dentista'],
      status,
    },
  });

  return locale.id;
}

/** Busca que declara ter saído de um termo sugerido. */
async function buscaComTermo(segmentLocaleId: string): Promise<string> {
  const search = await admin.prospectingSearch.create({
    data: {
      tenantId,
      niche: 'Dentistas',
      stateUf: 'SP',
      city: 'São Paulo',
      segmentLocaleId,
    },
  });

  return search.id;
}

/**
 * Timeout explicito de 60s nos hooks, e a razao esta medida.
 *
 * O padrao do vitest e 10s, e este `beforeAll` falhava em ~12s com
 * `Can't reach database server at localhost:5434` — **sem deixar rastro no log
 * do Postgres**. A conexao nao chegava ao servidor: morria no encaminhamento
 * de porta do Docker Desktop, sob um caminho de disco que o proprio log mostra
 * levando 20 segundos para escrever 201 buffers.
 *
 * Falhava uma corrida em cada duas ou tres. Suite intermitente treina a
 * ignorar vermelho — e o vermelho aqui e ambiente, nao regressao.
 *
 * O outro lado da correcao esta no `.env`: `connect_timeout=30&pool_timeout=30`.
 *
 * **Isto tolera a lentidao, nao a conserta.** Os 20s de checkpoint continuam
 * la, e sao configuracao de maquina — Docker Desktop, WSL2, antivirus varrendo
 * o volume.
 */
const TIMEOUT_HOOK_MS = 60_000;

beforeAll(async () => {
  await admin.$connect();

  const tenant = await admin.tenant.create({
    data: { name: `Tenant Pipeline ${suffix}`, slug: `pipeline-${suffix}`, isDemo: true },
  });
  tenantId = tenant.id;

  const search = await admin.prospectingSearch.create({
    data: { tenantId, niche: 'Dentistas', stateUf: 'SP', city: 'São Paulo' },
  });
  searchId = search.id;

  const start = periodStart();
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

  await admin.planUsage.create({
    data: { tenantId, periodStart: start, periodEnd: end },
  });

  // Segmento é global, não pertence a tenant nenhum — por isso sai na limpeza
  // por conta própria, e não de carona no cascade do tenant.
  const segment = await admin.segment.create({
    data: {
      externalId: `TEST-${suffix}`,
      macroSegment: 'Teste',
      name: `Segmento Pipeline ${suffix}`,
      services: [],
      targetSectors: [],
      opportunitySignals: [],
      isActive: false,
    },
  });
  segmentId = segment.id;
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  // Roda mesmo se o `beforeAll` tiver falhado: sem isto, uma falha de conexao
  // deixa tenant e segmento de teste para tras, e a corrida seguinte encontra
  // o `slug` ja ocupado — a falha de ambiente vira falha de dado.
  if (tenantId) await admin.tenant.deleteMany({ where: { id: tenantId } });
  if (segmentId) await admin.segment.deleteMany({ where: { id: segmentId } });
  await prisma.$disconnect();
  await admin.$disconnect();
}, TIMEOUT_HOOK_MS);

describe('regra 5.3 — cota', () => {
  it('primeira busca cobra apenas pelos leads novos e zera a reserva', async () => {
    const provider = new MockLeadSourceProvider();
    const jobId = await enqueue('primeira');

    const antes = await usage();
    expect(antes.reserved).toBe(REQUESTED);

    const result = await processScrapeJob(prisma, provider, payload(jobId));

    expect(result.newLeads).toBeGreaterThan(0);
    expect(result.duplicates).toBe(0);

    const depois = await usage();
    // A reserva é liquidada por inteiro; o consumo é só o que virou lead novo.
    expect(depois.reserved).toBe(0);
    expect(depois.settled).toBe(result.newLeads);
  });

  it('repetir a mesma busca não duplica lead nem cobra de novo', async () => {
    const provider = new MockLeadSourceProvider();
    const jobId = await enqueue('repetida');

    const antes = await usage();
    const result = await processScrapeJob(prisma, provider, payload(jobId));

    // O mock gera place_id novo a cada job; a deduplicação aqui acontece pelo
    // fingerprint (nome + telefone + CEP), que é o caminho que de fato protege
    // quando a fonte não devolve identificador estável.
    expect(result.newLeads).toBe(0);
    expect(result.duplicates).toBeGreaterThan(0);

    const depois = await usage();
    expect(depois.reserved).toBe(0);
    expect(depois.settled).toBe(antes.settled);

    const total = await admin.lead.count({ where: { tenantId } });
    expect(total).toBe(antes.settled);
  });

  it('job que falha devolve toda a reserva', async () => {
    const quebrado: LeadSourceProvider = {
      name: 'quebrado',
      createSearch: async () => {
        throw new Error('Fonte indisponível');
      },
      getJob: async () => {
        throw new Error('Fonte indisponível');
      },
      getResults: async () => [],
      cancelJob: async () => undefined,
    };

    const jobId = await enqueue('falha');
    const antes = await usage();
    expect(antes.reserved).toBe(REQUESTED);

    await expect(
      processScrapeJob(prisma, quebrado, payload(jobId)),
    ).rejects.toThrow();

    const depois = await usage();
    expect(depois.reserved).toBe(0);
    // Falhar não pode consumir crédito nem, pior, gerar crédito.
    expect(depois.settled).toBe(antes.settled);

    const job = await admin.scrapeJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('FAILED');
  });
});

describe('regra 5.4 — nenhum lead concluído sem score explicado', () => {
  it('todo lead criado pelo pipeline tem score e motivos', async () => {
    const leads = await admin.lead.findMany({
      where: { tenantId },
      include: { score: { include: { reasons: true } } },
    });

    expect(leads.length).toBeGreaterThan(0);

    const semScore = leads.filter((lead) => !lead.score);
    const semMotivo = leads.filter(
      (lead) => lead.score && lead.score.reasons.length === 0,
    );

    expect(semScore.map((lead) => lead.name)).toEqual([]);
    expect(semMotivo.map((lead) => lead.name)).toEqual([]);
  });

  it('nenhum dado pessoal de avaliador foi persistido', async () => {
    // Regra 5.5, verificada no mesmo ciclo: o payload bruto gravado em
    // LeadSourceRecord não pode conter os campos de pessoa física.
    const records = await admin.leadSourceRecord.findMany({
      where: { tenantId },
      select: { payload: true },
      take: 50,
    });

    /**
     * A linha que faltava.
     *
     * Até 17/09/2026 este teste era um `for` sobre `records` com as asserções
     * dentro e nada fora. **Em lista vazia o laço não executa e o teste
     * passa** — verde por não ter olhado nada. É o mesmo defeito que o e2e de
     * planos descreve sobre si mesmo: teste condicional que passa na ausência
     * do que deveria checar aparece como cobertura no relatório, e é pior que
     * teste nenhum, porque desencoraja quem faria a pergunta de novo.
     *
     * Hoje há linhas — o `MockLeadSourceProvider` roda o pipeline de verdade.
     * O ponto não é que falte: é que nada garantia, e no dia em que a fixture
     * mudasse o teste emudeceria sem ficar vermelho.
     */
    expect(records.length).toBeGreaterThan(0);

    const foraDoContrato = new Set<string>();

    for (const record of records) {
      const conteudo = record.payload;

      // Objeto, e não lista nem escalar. Um payload que virasse array faria
      // `Object.keys` devolver índices, e a conferência abaixo passaria
      // achando que `0`, `1`, `2` são chaves desconhecidas — ou, pior, um
      // escalar daria `{}` e passaria calado.
      expect(
        conteudo !== null && typeof conteudo === 'object' && !Array.isArray(conteudo),
      ).toBe(true);

      for (const chave of Object.keys(conteudo as object)) {
        if (!AUTORIZADAS.has(chave)) foraDoContrato.add(chave);
      }
    }

    /**
     * Lista de autorizados, e não de proibidos.
     *
     * A versão anterior procurava dois nomes conhecidos, `user_reviews` e
     * `owner`. Isso exige adivinhar como o campo indesejado vai se chamar:
     * `reviewer`, `author`, `profile_url` ou `photos_uploaded_by` passariam
     * inteiros. Afirmar o conjunto autorizado não depende de adivinhação — o
     * que não está em `RawLead` reprova, tenha o nome que tiver.
     */
    expect([...foraDoContrato].sort()).toEqual([]);

    /**
     * A varredura por texto continua, e não é redundante com a de cima.
     *
     * A conferência de chaves só enxerga o primeiro nível. Se um dado pessoal
     * entrasse aninhado dentro de uma chave autorizada — digamos um
     * `openHours` que trouxesse junto quem publicou o horário —, o conjunto de
     * chaves de topo continuaria correto. Esta olha o documento inteiro.
     */
    for (const record of records) {
      const serialized = JSON.stringify(record.payload ?? {});
      expect(serialized).not.toContain('user_reviews');
      expect(serialized).not.toContain('"owner"');
    }
  });
});

/**
 * Veredito sobre termo sugerido pela taxonomia.
 *
 * Este bloco existe porque o custo de errar aqui não é local: o status de um
 * `SegmentLocale` é global ao país, não ao tenant. Um bug que promove termo
 * ruim faz todos os próximos clientes daquele país começarem com busca vazia;
 * um bug que rebaixa termo bom apaga curadoria humana. Nos dois casos o
 * sintoma aparece longe da causa, semanas depois.
 */
describe('validação de termos por busca real', () => {
  it('resultado suficiente promove GERADO para VALIDADO', async () => {
    const localeId = await criarLocale('GERADO', `ok-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-ok', REQUESTED_LARGO, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED_LARGO, alvo));

    const locale = await admin.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    expect(locale.status).toBe('VALIDADO');
    expect(locale.resultCount).toBe(RESULTADOS_LARGO);
    expect(locale.validatedAt).not.toBeNull();
  });

  it('valida mesmo quando todos os resultados são duplicados', async () => {
    // O guarda mais importante do bloco. Contar `createdLeadIds.length` em vez
    // de `rawLeads.length` passaria em tudo, menos aqui: um termo perfeito
    // rodado sobre base já coletada devolve zero leads novos e seria reprovado.
    // Encontrar empresa é o que o termo tem de provar; ser inédita, não.
    const localeId = await criarLocale('GERADO', `dup-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-dup', REQUESTED_LARGO, alvo);

    const provider = new MockLeadSourceProvider();
    const resultado = await processScrapeJob(
      prisma,
      provider,
      payload(jobId, REQUESTED_LARGO, alvo),
    );

    expect(resultado.newLeads).toBe(0);
    expect(resultado.duplicates).toBe(RESULTADOS_LARGO);

    const locale = await admin.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    expect(locale.status).toBe('VALIDADO');
    expect(locale.resultCount).toBe(RESULTADOS_LARGO);
  });

  it('resultado insuficiente registra a contagem sem apagar o termo', async () => {
    const localeId = await criarLocale('GERADO', `poucos-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-poucos', REQUESTED, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED, alvo));

    const locale = await admin.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    // Continua sob suspeita, e continua utilizável: uma cidade sem esse tipo
    // de negócio não é prova contra o termo. A contagem fica registrada para
    // que o padrão apareça se ele falhar em várias.
    expect(locale.status).toBe('GERADO');
    expect(locale.resultCount).toBe(1);
    expect(locale.validatedAt).toBeNull();
  });

  it('termo CURADO não é rebaixado por busca fraca', async () => {
    const localeId = await criarLocale('CURADO', `curado-${suffix}`);
    const alvo = await buscaComTermo(localeId);
    const jobId = await enqueue('veredito-curado', REQUESTED, alvo);

    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId, REQUESTED, alvo));

    const locale = await admin.segmentLocale.findUniqueOrThrow({
      where: { id: localeId },
    });

    // Revisão humana não é revogada por estatística de uma cidade. O `null` em
    // resultCount é parte da afirmação: o veredito nem chegou a ser calculado.
    expect(locale.status).toBe('CURADO');
    expect(locale.resultCount).toBeNull();
  });

  it('busca sem termo sugerido não altera locale nenhum', async () => {
    const antes = await admin.segmentLocale.findMany({
      where: { segmentId },
      orderBy: { locale: 'asc' },
      select: { locale: true, status: true, resultCount: true },
    });

    const jobId = await enqueue('veredito-ausente');
    const provider = new MockLeadSourceProvider();
    await processScrapeJob(prisma, provider, payload(jobId));

    const depois = await admin.segmentLocale.findMany({
      where: { segmentId },
      orderBy: { locale: 'asc' },
      select: { locale: true, status: true, resultCount: true },
    });

    expect(depois).toEqual(antes);
  });
});
