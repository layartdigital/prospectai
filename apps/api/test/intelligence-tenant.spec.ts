import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { GraphExpandResponse, GraphResponse, SessionResponse } from '@propectai/types';
import { fingerprintInput } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { ProvaDeProfundidade } from '../src/intelligence/depth-proof';
import { conferirLimpeza } from './limpeza';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Intelligence Explorer: isolamento entre tenants e limites, pela camada HTTP.
 *
 * Mesmo desenho de `tenant-isolation-http.spec.ts`: sobe o `AppModule` em porta
 * efemera, registra duas contas de verdade e faz requisicoes autenticadas. As
 * fixtures entram pelo papel administrativo (montar cenario e operacao
 * administrativa); **toda assercao e feita pelo papel da aplicacao**, que e o
 * sujeito a RLS.
 *
 * O que este arquivo prova, em ordem de importancia:
 *
 * 1. O Beta, conhecendo ids do Alfa, nao le nada do Alfa — nem no grafo, nem
 *    na expansao de nenhum tipo de no.
 * 2. Id de outro tenant e id inexistente respondem **igual** (404 com o mesmo
 *    corpo): a diferenca seria confirmacao de existencia.
 * 3. Um lead do Beta que aponte para a pesquisa do Alfa (a FK `searchId` nao e
 *    composta) nao aparece na expansao do Alfa.
 * 4. As arestas so existem onde ha chave estrangeira, e carregam proveniencia.
 * 5. Os tetos (pagina, relacao permitida, profundidade) valem no servidor.
 * 6. `DESCONHECIDO` chega ao cliente como `DESCONHECIDO`.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const admin = criarPrismaAdmin();
const suffix = Date.now().toString(36);

let app: INestApplication;
let baseUrl = '';

interface Actor {
  email: string;
  tenantId: string;
  cookie: string;
}

let alfa: Actor;
let beta: Actor;

const ids = {
  lead: '',
  search: '',
  score: '',
  reason: '',
  presence: '',
  card: '',
  stage: '',
  audit: '',
  check: '',
  intruso: '', // lead do Beta apontando para a pesquisa do Alfa
  leadBeta: '',
  // QA-01: lead do Alfa EXCLUIDO LOGICAMENTE e seus filhos; cartao "orfao"
  delLead: '',
  delScore: '',
  delPresence: '',
  delAudit: '',
  delCard: '',
  orfaoCard: '', // cartao do tenant Alfa apontando para um lead do Beta
};

const BOOT_TIMEOUT_MS = 60_000;

function fingerprint(name: string): string {
  return createHash('sha256').update(fingerprintInput(name, null, null)).digest('hex');
}

function collectCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

async function register(label: string): Promise<Actor> {
  const email = `${label}-${suffix}@teste.propectai.local`;
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Usuário ${label}`,
      tenantName: `Workspace ${label} ${suffix}`,
      email,
      password: 'SenhaDeTeste123',
    }),
  });
  expect(response.status).toBe(201);
  const session = (await response.json()) as SessionResponse;
  return { email, tenantId: session.tenant!.id, cookie: collectCookies(response) };
}

async function get<T>(actor: Actor | null, rota: string): Promise<{ status: number; body: T; texto: string }> {
  const response = await fetch(`${baseUrl}/api/v1${rota}`, {
    headers: actor ? { Cookie: actor.cookie } : {},
  });
  const texto = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(texto);
  } catch {
    body = null;
  }
  return { status: response.status, body: body as T, texto };
}

const graph = (a: Actor | null, leadId: string) => get<GraphResponse>(a, `/intelligence/graph?leadId=${leadId}`);

/**
 * Prova de profundidade como um cliente honesto a teria: a mesma que o servidor
 * emitiria para o no `ref` na profundidade `depth`, neste tenant. Os testes de
 * adulteracao passam `prova` explicitamente. O segredo e o mesmo do ambiente do
 * app em teste (`JWT_ACCESS_SECRET`).
 */
function provaHonesta(tenantId: string, ref: string, depth: number): string {
  return new ProvaDeProfundidade(process.env.JWT_ACCESS_SECRET as string).assinar(tenantId, ref, depth);
}

const expand = (
  a: Actor | null,
  ref: string,
  kind: string,
  extra = '',
  depth = 0,
  prova?: string,
) =>
  get<GraphExpandResponse>(
    a,
    `/intelligence/expand?ref=${encodeURIComponent(ref)}&kind=${kind}&parentDepth=${depth}` +
      `&parentDepthProof=${prova ?? (a ? provaHonesta(a.tenantId, ref, depth) : 'x'.repeat(22))}${extra}`,
  );

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // Igual ao main.ts.
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  alfa = await register('alfa');
  beta = await register('beta');

  const t = alfa.tenantId;

  const search = await admin.prospectingSearch.create({
    data: { tenantId: t, niche: `Dentista ${suffix}`, city: 'Campinas', stateUf: 'SP', leadsFound: 1 },
  });
  ids.search = search.id;

  const lead = await admin.lead.create({
    data: {
      tenantId: t,
      searchId: search.id,
      name: `Clínica do Alfa ${suffix}`,
      category: 'Dentista',
      addressCity: 'Campinas',
      addressStateUf: 'SP',
      phoneRaw: '(19) 99999-1234',
      fingerprint: fingerprint(`Clínica do Alfa ${suffix}`),
      websiteStatus: 'SEM_SITE',
    },
  });
  ids.lead = lead.id;

  const score = await admin.leadScore.create({
    data: { tenantId: t, leadId: lead.id, value: 72, level: 'ALTA' },
  });
  ids.score = score.id;
  const reason = await admin.leadScoreReason.create({
    data: { tenantId: t, scoreId: score.id, code: 'SEM_SITE', label: 'Sem site próprio', weight: 20, polarity: 'POSITIVE', evidence: 'website vazio' },
  });
  ids.reason = reason.id;

  // Presenca com defaults: todo sinal nasce DESCONHECIDO.
  const presence = await admin.leadDigitalPresence.create({ data: { tenantId: t, leadId: lead.id } });
  ids.presence = presence.id;

  const stage = await admin.pipelineStage.create({ data: { tenantId: t, name: 'Novo', slug: `novo-${suffix}`, order: 0 } });
  ids.stage = stage.id;
  const card = await admin.pipelineCard.create({ data: { tenantId: t, leadId: lead.id, stageId: stage.id } });
  ids.card = card.id;

  const audit = await admin.digitalPresenceAudit.create({
    data: { tenantId: t, leadId: lead.id, auditVersion: 'audit-v1', status: 'COMPLETED' },
  });
  ids.audit = audit.id;
  const check = await admin.digitalPresenceCheck.create({
    data: { tenantId: t, auditId: audit.id, check: 'HTTPS', outcome: 'OK', result: { segredo: 'nao-deve-sair' }, observedUrl: 'https://exemplo.invalid/privado' },
  });
  ids.check = check.id;

  // 30 notas: mais que o teto de pagina (25).
  await admin.leadNote.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({ tenantId: t, leadId: lead.id, content: `nota ${i} ${'x'.repeat(400)}` })),
  });
  // soft delete: nao pode aparecer nem na contagem nem na pagina
  await admin.leadNote.create({
    data: { tenantId: t, leadId: lead.id, content: 'NOTA APAGADA nao deve aparecer', deletedAt: new Date() },
  });
  await admin.leadActivity.create({
    data: { tenantId: t, leadId: lead.id, type: 'LEAD_CREATED', metadata: { interno: 'nao-deve-sair' } },
  });
  await admin.leadContactRecord.create({
    data: { tenantId: t, leadId: lead.id, channel: 'WHATSAPP', direction: 'SENT', outcome: 'sem resposta' },
  });
  await admin.leadFollowUp.create({
    data: { tenantId: t, leadId: lead.id, dueAt: new Date('2026-12-01T12:00:00Z') },
  });

  // Lead do Beta apontando para a pesquisa do Alfa. A FK `searchId` e simples,
  // entao o banco aceita; o servico precisa ignora-lo pelo tenantId.
  const intruso = await admin.lead.create({
    data: {
      tenantId: beta.tenantId,
      searchId: search.id,
      name: `Intruso do Beta ${suffix}`,
      fingerprint: fingerprint(`Intruso do Beta ${suffix}`),
      websiteStatus: 'SEM_SITE',
    },
  });
  ids.intruso = intruso.id;

  const leadBeta = await admin.lead.create({
    data: {
      tenantId: beta.tenantId,
      name: `Empresa do Beta ${suffix}`,
      fingerprint: fingerprint(`Empresa do Beta ${suffix}`),
      websiteStatus: 'SEM_SITE',
    },
  });
  ids.leadBeta = leadBeta.id;

  // QA-01 — lead excluido logicamente, com score, presenca, auditoria e cartao.
  // Esses filhos nao tem `deletedAt` proprio: quem os esconde e a exclusao do lead.
  const apagado = await admin.lead.create({
    data: {
      tenantId: t,
      name: `Lead apagado do Alfa ${suffix}`,
      fingerprint: fingerprint(`Lead apagado do Alfa ${suffix}`),
      websiteStatus: 'SEM_SITE',
      deletedAt: new Date(),
    },
  });
  ids.delLead = apagado.id;
  ids.delScore = (await admin.leadScore.create({ data: { tenantId: t, leadId: apagado.id, value: 10, level: 'BAIXA' } })).id;
  ids.delPresence = (await admin.leadDigitalPresence.create({ data: { tenantId: t, leadId: apagado.id } })).id;
  ids.delAudit = (
    await admin.digitalPresenceAudit.create({ data: { tenantId: t, leadId: apagado.id, auditVersion: 'audit-v1', status: 'COMPLETED' } })
  ).id;
  ids.delCard = (await admin.pipelineCard.create({ data: { tenantId: t, leadId: apagado.id, stageId: stage.id } })).id;
  // A FK `pipeline_cards.leadId` e simples: o banco aceita um cartao do Alfa apontando para lead do Beta.
  ids.orfaoCard = (await admin.pipelineCard.create({ data: { tenantId: t, leadId: leadBeta.id, stageId: stage.id } })).id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await admin.tenant.deleteMany({
    where: { id: { in: [alfa?.tenantId, beta?.tenantId].filter(Boolean) as string[] } },
  });
  await admin.user.deleteMany({
    where: { email: { in: [alfa?.email, beta?.email].filter(Boolean) as string[] } },
  });
  const sobras = await conferirLimpeza(admin, suffix);
  await admin.$disconnect();
  if (sobras !== null) throw new Error(sobras);
}, BOOT_TIMEOUT_MS);

describe('Intelligence Explorer — o dono enxerga as proprias relacoes', () => {
  it('grafo inicial: lead, pesquisa, score, presenca e cartao, cada um com aresta comprovada', async () => {
    const { status, body } = await graph(alfa, ids.lead);
    expect(status).toBe(200);

    const tipos = body.nodes.map((n) => n.kind).sort();
    expect(tipos).toEqual(['LEAD', 'PIPELINE_CARD', 'PRESENCE', 'SCORE', 'SEARCH']);
    expect(body.rootRef).toBe(`LEAD:${ids.lead}`);
    expect(body.edges).toHaveLength(4);

    for (const e of body.edges) {
      expect(e.verification).toBe('VERIFICADA');
      expect(e.provenance.kind === 'FOREIGN_KEY' || e.provenance.kind === 'SAME_ROW_FIELD').toBe(true);
      expect(e.provenance.source.length).toBeGreaterThan(0);
    }
  });

  it('o lead raiz informa quantos filhos de cada tipo existem, sem te-los enviado', async () => {
    const { body } = await graph(alfa, ids.lead);
    const raiz = body.nodes.find((n) => n.kind === 'LEAD')!;
    const total = (k: string) => raiz.expansions.find((x) => x.kind === k)?.total;

    expect(total('NOTE')).toBe(30);
    expect(total('ACTIVITY')).toBe(1);
    expect(total('CONTACT_RECORD')).toBe(1);
    expect(total('FOLLOW_UP')).toBe(1);
    expect(total('AUDIT')).toBe(1);
    expect(body.nodes.some((n) => n.kind === 'NOTE')).toBe(false);
  });

  it('telefone sai mascarado no plano que mascara', async () => {
    const { body } = await graph(alfa, ids.lead);
    const raiz = body.nodes.find((n) => n.kind === 'LEAD')!;
    const tel = raiz.properties.find((p) => p.label.startsWith('Telefone'));
    // Plano FREE mascara; se o plano de teste liberar o numero, o rotulo muda
    // e este teste continua dizendo a verdade sobre o que foi enviado.
    if (tel?.label === 'Telefone (mascarado pelo plano)') {
      expect(tel.value).not.toContain('99999-1234');
    }
  });

  it('expandir notas: pagina de ate 25, texto recortado e proxima posicao', async () => {
    const { status, body } = await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&pageSize=25');
    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(25);
    expect(body.expanded.nextOffset).toBe(25);
    for (const n of body.nodes) {
      const texto = n.properties.find((p) => p.label === 'Texto (recorte)')?.value ?? '';
      expect(texto.length).toBeLessThanOrEqual(140);
    }

    const resto = await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&pageSize=25&offset=25');
    expect(resto.body.nodes).toHaveLength(5);
    expect(resto.body.expanded.nextOffset).toBeNull();
  });

  it('nao devolve JSON livre nem URL do prospect', async () => {
    const atividades = await expand(alfa, `LEAD:${ids.lead}`, 'ACTIVITY');
    expect(atividades.texto).not.toContain('nao-deve-sair');

    const checagens = await expand(alfa, `AUDIT:${ids.audit}`, 'AUDIT_CHECK', '', 1);
    expect(checagens.status).toBe(200);
    expect(checagens.body.nodes).toHaveLength(1);
    expect(checagens.texto).not.toContain('nao-deve-sair');
    expect(checagens.texto).not.toContain('exemplo.invalid');
  });

  it('sinais sem verificacao chegam como DESCONHECIDO, nunca AUSENTE', async () => {
    const { status, body } = await expand(alfa, `PRESENCE:${ids.presence}`, 'SIGNAL', '&pageSize=25', 1);
    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(7);
    expect(body.nodes.every((n) => n.state === 'DESCONHECIDO')).toBe(true);
    expect(body.edges.every((e) => e.provenance.kind === 'SAME_ROW_FIELD')).toBe(true);
  });

  it('motivos do score e etapa do cartao', async () => {
    const motivos = await expand(alfa, `SCORE:${ids.score}`, 'SCORE_REASON', '', 1);
    expect(motivos.body.nodes).toHaveLength(1);
    expect(motivos.body.nodes[0]?.label).toBe('Sem site próprio');

    const etapa = await expand(alfa, `PIPELINE_CARD:${ids.card}`, 'PIPELINE_STAGE', '', 1);
    expect(etapa.body.nodes[0]?.label).toBe('Novo');
  });

  it('nota apagada (soft delete) nao entra na contagem nem na pagina', async () => {
    const { body } = await graph(alfa, ids.lead);
    expect(body.nodes.find((n) => n.kind === 'LEAD')!.expansions.find((x) => x.kind === 'NOTE')?.total).toBe(30);
    const resto = await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&pageSize=25&offset=25');
    expect(resto.texto).not.toContain('NOTA APAGADA');
  });

  it('expandir a pesquisa lista so leads do proprio tenant, mesmo com intruso apontando para ela', async () => {
    const { status, body } = await expand(alfa, `SEARCH:${ids.search}`, 'LEAD');
    expect(status).toBe(200);
    expect(body.nodes.map((n) => n.ref)).toEqual([`LEAD:${ids.lead}`]);
    expect(body.expanded.nextOffset).toBeNull();
    expect(JSON.stringify(body)).not.toContain(ids.intruso);
  });
});

describe('Intelligence Explorer — isolamento entre tenants', () => {
  it('o Beta, com o id do lead do Alfa, recebe 404 no grafo', async () => {
    const { status } = await graph(beta, ids.lead);
    expect(status).toBe(404);
  });

  it('id de outro tenant e id inexistente respondem exatamente igual', async () => {
    const alheio = await graph(beta, ids.lead);
    const inexistente = await graph(beta, 'cm0naoexiste00000001');
    expect(alheio.status).toBe(inexistente.status);
    expect(alheio.texto).toBe(inexistente.texto);
  });

  it('o Beta nao expande nenhum tipo de no do Alfa', async () => {
    const casos: [string, string][] = [
      [`LEAD:${ids.lead}`, 'NOTE'],
      [`LEAD:${ids.lead}`, 'ACTIVITY'],
      [`LEAD:${ids.lead}`, 'AUDIT'],
      [`LEAD:${ids.lead}`, 'SCORE'],
      [`LEAD:${ids.lead}`, 'PRESENCE'],
      [`LEAD:${ids.lead}`, 'PIPELINE_CARD'],
      [`LEAD:${ids.lead}`, 'SEARCH'],
      [`SEARCH:${ids.search}`, 'LEAD'],
      [`SCORE:${ids.score}`, 'SCORE_REASON'],
      [`PRESENCE:${ids.presence}`, 'SIGNAL'],
      [`AUDIT:${ids.audit}`, 'AUDIT_CHECK'],
      [`PIPELINE_CARD:${ids.card}`, 'PIPELINE_STAGE'],
    ];
    for (const [ref, kind] of casos) {
      const { status, texto } = await expand(beta, ref, kind);
      expect([ref, kind, status]).toEqual([ref, kind, 404]);
      expect(texto).not.toContain(alfa.tenantId);
      expect(texto).not.toContain('Clínica do Alfa');
    }
  });

  it('o Beta so enxerga o proprio grafo, sem nenhum id do Alfa', async () => {
    const { status, body, texto } = await graph(beta, ids.leadBeta);
    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(1);
    for (const valor of Object.values(ids)) {
      if (valor === ids.leadBeta || valor === ids.intruso) continue;
      expect(texto).not.toContain(valor);
    }
    expect(texto).not.toContain(alfa.tenantId);
  });

  it('lead do Beta com searchId do Alfa nao ganha no de pesquisa do Alfa', async () => {
    const { status, body } = await graph(beta, ids.intruso);
    expect(status).toBe(200);
    expect(body.nodes.some((n) => n.kind === 'SEARCH')).toBe(false);
  });

  it('x-tenant-id forjado nao troca de workspace', async () => {
    const response = await fetch(`${baseUrl}/api/v1/intelligence/graph?leadId=${ids.lead}`, {
      headers: { Cookie: beta.cookie, 'x-tenant-id': alfa.tenantId },
    });
    expect([403, 404]).toContain(response.status);
  });

  it('sem sessao nao ha leitura', async () => {
    expect((await graph(null, ids.lead)).status).toBe(401);
    expect((await expand(null, `LEAD:${ids.lead}`, 'NOTE')).status).toBe(401);
  });
});

describe('Intelligence Explorer — limites no servidor', () => {
  it('relacao nao permitida para o tipo de no responde 400', async () => {
    expect((await expand(alfa, `LEAD:${ids.lead}`, 'SCORE_REASON')).status).toBe(400);
    expect((await expand(alfa, `SIGNAL:${ids.presence}:hasEmail`, 'LEAD')).status).toBe(400);
    expect((await expand(alfa, `NOTE:cm0qualquerid0001`, 'LEAD')).status).toBe(400);
  });

  it('referencia malformada responde 400, nao 500', async () => {
    for (const ref of ['', 'LEAD', 'LEAD:abc', "LEAD:cm0lead0000001';--", 'TENANT:cm0lead00000001', 'LEAD:cm0lead00000001:extra']) {
      const r = await expand(alfa, ref, 'NOTE');
      expect([ref, r.status]).toEqual([ref, 400]);
    }
  });

  it('pageSize acima do teto e rejeitado', async () => {
    expect((await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&pageSize=26')).status).toBe(400);
    expect((await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&pageSize=0')).status).toBe(400);
    expect((await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '&offset=-1')).status).toBe(400);
  });

  it('profundidade acima do teto e rejeitada', async () => {
    // depth 3 com prova valida: o filho seria depth 4 (> maxDepth 3)
    const r = await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '', 3);
    expect(r.status).toBe(400);
    expect(r.texto).toContain('Profundidade máxima');
    // valor absurdo: barrado ja pelo DTO
    expect((await expand(alfa, `LEAD:${ids.lead}`, 'NOTE', '', 99)).status).toBe(400);
  });

  it('parametro desconhecido e recusado (nada de leadId duplicado ou tenantId no query)', async () => {
    const r = await get(alfa, `/intelligence/graph?leadId=${ids.lead}&tenantId=${beta.tenantId}`);
    expect(r.status).toBe(400);
  });

  it('leadId com formato invalido responde 400', async () => {
    expect((await graph(alfa, 'x')).status).toBe(400);
    expect((await graph(alfa, "cm0';drop table leads;--")).status).toBe(400);
  });
});

describe('Intelligence Explorer — profundidade imposta pelo servidor (QA-01)', () => {
  it('todo no devolvido traz prova de profundidade, e a prova valida abre a expansao', async () => {
    const { body } = await graph(alfa, ids.lead);
    for (const n of body.nodes) expect(n.depthProof).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const raiz = body.nodes.find((n) => n.kind === 'LEAD')!;
    const r = await expand(alfa, raiz.ref, 'NOTE', '', raiz.depth, raiz.depthProof);
    expect(r.status).toBe(200);
    expect(r.body.nodes.every((n) => n.depth === 1 && !!n.depthProof)).toBe(true);
  });

  it('cadeia real lead -> pesquisa -> lead -> presenca chega ao teto; o passo seguinte e recusado', async () => {
    const g = (await graph(alfa, ids.lead)).body;
    const pesquisa = g.nodes.find((n) => n.kind === 'SEARCH')!; // depth 1
    const leads = (await expand(alfa, pesquisa.ref, 'LEAD', '', pesquisa.depth, pesquisa.depthProof)).body;
    const filho = leads.nodes.find((n) => n.ref === `LEAD:${ids.lead}`)!; // depth 2
    expect(filho.depth).toBe(2);
    const pres = (await expand(alfa, filho.ref, 'PRESENCE', '', filho.depth, filho.depthProof)).body;
    const presenca = pres.nodes[0]!; // depth 3 = maxDepth
    expect(presenca.depth).toBe(3);
    const alem = await expand(alfa, presenca.ref, 'SIGNAL', '', presenca.depth, presenca.depthProof);
    expect(alem.status).toBe(400);
    expect(alem.texto).toContain('Profundidade máxima');
  });

  it('parentDepth reduzido artificialmente nao escapa do teto', async () => {
    const g = (await graph(alfa, ids.lead)).body;
    const pesquisa = g.nodes.find((n) => n.kind === 'SEARCH')!;
    const leads = (await expand(alfa, pesquisa.ref, 'LEAD', '', pesquisa.depth, pesquisa.depthProof)).body;
    const filho = leads.nodes.find((n) => n.ref === `LEAD:${ids.lead}`)!; // depth real = 2
    for (const mentira of [0, 1]) {
      const r = await expand(alfa, filho.ref, 'PRESENCE', '', mentira, filho.depthProof);
      expect([mentira, r.status]).toEqual([mentira, 400]);
      expect(r.texto).toContain('Prova de profundidade inválida');
    }
  });

  it('prova ausente, adulterada, de outro no ou de outro tenant e recusada', async () => {
    const raiz = (await graph(alfa, ids.lead)).body.nodes.find((n) => n.kind === 'LEAD')!;
    const outro = (await graph(alfa, ids.lead)).body.nodes.find((n) => n.kind === 'SCORE')!;
    const adulterada = raiz.depthProof!.slice(0, -1) + (raiz.depthProof!.endsWith('A') ? 'B' : 'A');
    const casos: [string, string][] = [
      ['adulterada', adulterada],
      ['de outro no', outro.depthProof!],
      ['de outro tenant', provaHonesta(beta.tenantId, raiz.ref, 0)],
      ['tamanho errado', raiz.depthProof! + 'x'],
    ];
    for (const [rotulo, prova] of casos) {
      const r = await expand(alfa, raiz.ref, 'NOTE', '', 0, prova);
      expect([rotulo, r.status]).toEqual([rotulo, 400]);
    }
    // sem o parametro: o DTO ja barra
    const sem = await get(alfa, `/intelligence/expand?ref=${encodeURIComponent(raiz.ref)}&kind=NOTE&parentDepth=0`);
    expect(sem.status).toBe(400);
  });

  it('a prova de um tenant nao serve a outro, mesmo para o mesmo no', async () => {
    const raiz = (await graph(alfa, ids.lead)).body.nodes.find((n) => n.kind === 'LEAD')!;
    const r = await expand(beta, raiz.ref, 'NOTE', '', 0, raiz.depthProof);
    expect(r.status).toBe(400);
  });
});

describe('Intelligence Explorer — soft delete e dados inconsistentes (QA-01)', () => {
  it('lead excluido responde 404 no grafo e em toda expansao direta', async () => {
    expect((await graph(alfa, ids.delLead)).status).toBe(404);
    for (const kind of ['NOTE', 'SCORE', 'PRESENCE', 'AUDIT', 'PIPELINE_CARD', 'ACTIVITY']) {
      expect([kind, (await expand(alfa, `LEAD:${ids.delLead}`, kind)).status]).toEqual([kind, 404]);
    }
  });

  it('score, presenca, auditoria e cartao de lead excluido nao abrem por referencia conhecida', async () => {
    const casos: [string, string][] = [
      [`SCORE:${ids.delScore}`, 'SCORE_REASON'],
      [`PRESENCE:${ids.delPresence}`, 'SIGNAL'],
      [`AUDIT:${ids.delAudit}`, 'AUDIT_CHECK'],
      [`PIPELINE_CARD:${ids.delCard}`, 'PIPELINE_STAGE'],
    ];
    for (const [ref, kind] of casos) {
      const r = await expand(alfa, ref, kind, '', 1);
      expect([ref, r.status]).toEqual([ref, 404]);
    }
  });

  it('controle positivo: as mesmas entidades de um lead ativo continuam abrindo', async () => {
    expect((await expand(alfa, `SCORE:${ids.score}`, 'SCORE_REASON', '', 1)).status).toBe(200);
    expect((await expand(alfa, `PRESENCE:${ids.presence}`, 'SIGNAL', '', 1)).status).toBe(200);
    expect((await expand(alfa, `AUDIT:${ids.audit}`, 'AUDIT_CHECK', '', 1)).status).toBe(200);
    expect((await expand(alfa, `PIPELINE_CARD:${ids.card}`, 'PIPELINE_STAGE', '', 1)).status).toBe(200);
  });

  it('cartao do Alfa que aponta para lead do Beta (FK simples) nao abre para nenhum dos dois', async () => {
    const ref = `PIPELINE_CARD:${ids.orfaoCard}`;
    expect((await expand(alfa, ref, 'PIPELINE_STAGE', '', 1)).status).toBe(404);
    expect((await expand(beta, ref, 'PIPELINE_STAGE', '', 1)).status).toBe(404);
  });

  it('o Beta, com ids de entidades do Alfa (ativas ou de lead excluido), recebe sempre 404', async () => {
    const refs: [string, string][] = [
      [`SCORE:${ids.score}`, 'SCORE_REASON'],
      [`SCORE:${ids.delScore}`, 'SCORE_REASON'],
      [`PRESENCE:${ids.delPresence}`, 'SIGNAL'],
      [`AUDIT:${ids.delAudit}`, 'AUDIT_CHECK'],
      [`PIPELINE_CARD:${ids.delCard}`, 'PIPELINE_STAGE'],
    ];
    for (const [ref, kind] of refs) expect([ref, (await expand(beta, ref, kind, '', 1)).status]).toEqual([ref, 404]);
  });

  it('a pesquisa nao lista o lead excluido', async () => {
    const r = await expand(alfa, `SEARCH:${ids.search}`, 'LEAD', '', 1);
    expect(r.texto).not.toContain(ids.delLead);
  });
});
