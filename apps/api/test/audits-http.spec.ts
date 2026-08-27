import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SessionResponse } from '@propectai/types';
import { fingerprintInput } from '@propectai/types';
import { Queue } from 'bullmq';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import IORedis from 'ioredis';

import { AppModule } from '../src/app.module';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Auditoria de presenca digital pela API.
 *
 * Prova o que so a camada HTTP prova: o gate de plano cobrando na tentativa, a
 * recusa de lead sem site **antes** de consumir credito, e o isolamento entre
 * tenants no pedido e na leitura do resultado.
 *
 * O worker nao roda aqui. O job fica na fila, e a auditoria permanece `QUEUED`
 * — que e exatamente o estado que se quer verificar deste lado: **a API cria e
 * enfileira; quem executa e o worker.**
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

/**
 * Client de fixtures, com o papel que ignora RLS. Ver `prisma-admin.ts`.
 *
 * Aqui a separacao e mais simples que no worker: o codigo sob teste e a
 * aplicacao inteira, que usa o proprio `PrismaService` pelo Nest. Este client
 * so monta cenario e confere resultado — e e exatamente por isso que ele
 * precisa do papel administrativo.
 */
const prisma = criarPrismaAdmin();
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
let leadComSite = '';
let leadSemSite = '';
let leadDoGate = '';
const auditoriasCriadas: string[] = [];

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

async function pedir<T>(
  actor: Actor,
  rota: string,
  corpo?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}/api/v1${rota}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: actor.cookie,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as T,
  };
}

function inicioDoPeriodo(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
}

async function creditosUsados(tenantId: string): Promise<number> {
  const row = await prisma.planUsage.findUnique({
    where: { tenantId_periodStart: { tenantId, periodStart: inicioDoPeriodo() } },
  });
  return row?.auditsCount ?? 0;
}

async function criarLead(tenantId: string, rotulo: string, website: string | null): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      tenantId,
      name: `Empresa ${rotulo} ${suffix}`,
      fingerprint: fingerprint(`Empresa ${rotulo} ${suffix}`),
      website,
    },
  });
  return lead.id;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();

  // Mesma configuracao do main.ts. Divergir produziria um teste que passa
  // contra uma aplicacao que nao e a que roda em producao.
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

  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  alfa = await register('audit-alfa');
  beta = await register('audit-beta');

  leadComSite = await criarLead(alfa.tenantId, 'com-site', 'https://exemplo-auditoria.com.br');
  leadSemSite = await criarLead(alfa.tenantId, 'sem-site', null);
  // Lead proprio para o teste de saldo: os outros ficam com auditoria em
  // andamento, e auditoria em andamento passa na frente do gate de propósito.
  leadDoGate = await criarLead(alfa.tenantId, 'gate', 'https://exemplo-gate.com.br');
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();

  // Os jobs ficam na fila porque nenhum worker roda aqui. Sem esta limpeza eles
  // se acumulam no Redis a cada execucao da suite — e, pior, um worker ligado
  // depois os processaria contra tenants ja apagados, gerando uma rajada de
  // "Auditoria inexistente" sem causa aparente.
  if (auditoriasCriadas.length > 0) {
    const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6381', {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue('audit', { connection, prefix: 'propectai' });
    for (const id of auditoriasCriadas) {
      await queue.remove(id).catch(() => undefined);
    }
    await queue.close();
    await connection.quit();
  }

  await prisma.tenant.deleteMany({
    where: { id: { in: [alfa?.tenantId, beta?.tenantId].filter(Boolean) as string[] } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [alfa?.email, beta?.email].filter(Boolean) as string[] } },
  });
  await prisma.$disconnect();
}, BOOT_TIMEOUT_MS);

describe('saldo', () => {
  it('consultar o saldo nunca bloqueia', async () => {
    // Regra 5: nenhum modal de bloqueio abre sozinho. Carregar a tela nao pode
    // passar pelo `assert` de capability.
    const r = await pedir<{ disponivel: number; incluidas: number }>(alfa, '/audits/quota');
    expect(r.status).toBe(200);
    expect(r.body.incluidas > 0).toBe(true);
  });
});

describe('lead sem site', () => {
  it('e recusado com 400, e o motivo e explicito', async () => {
    const r = await pedir<{ code: string }>(alfa, '/audits', { leadId: leadSemSite });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('LEAD_SEM_SITE');
  });

  it('nao consome credito', async () => {
    const antes = await creditosUsados(alfa.tenantId);
    await pedir(alfa, '/audits', { leadId: leadSemSite });
    // Regra 4: campo vazio e DESCONHECIDO, nao AUSENTE. Nao ha medicao, entao
    // nao ha o que cobrar — e a recusa acontece antes da fila, poupando a
    // viagem inteira.
    expect(await creditosUsados(alfa.tenantId)).toBe(antes);
  });
});

describe('pedido valido', () => {
  it('cria a auditoria, enfileira e consome um credito', async () => {
    const antes = await creditosUsados(alfa.tenantId);

    const r = await pedir<{ auditId: string; status: string; creditosRestantes: number }>(
      alfa,
      '/audits',
      { leadId: leadComSite },
    );

    expect(r.status).toBe(201);
    expect(r.body.status).toBe('QUEUED');
    auditoriasCriadas.push(r.body.auditId);

    // O credito e consumido na TENTATIVA. O worker devolve quando a medicao
    // nao acontece — cobrar no fim deixaria pedidos simultaneos estourarem o
    // limite do plano.
    expect(await creditosUsados(alfa.tenantId)).toBe(antes + 1);

    const gravada = await prisma.digitalPresenceAudit.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: alfa.tenantId, id: r.body.auditId } },
    });
    expect(gravada.leadId).toBe(leadComSite);
    expect(gravada.status).toBe('QUEUED');
    // Nenhum worker rodou: a auditoria fica esperando, que e o estado correto
    // deste lado da fronteira.
    expect(gravada.finishedAt).toBe(null);
  });

  it('o resultado e legivel pelo dono', async () => {
    const id = auditoriasCriadas[0]!;
    const r = await pedir<{ auditId: string; checks: unknown[] }>(alfa, `/audits/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.auditId).toBe(id);
    // Ainda sem checagens: quem as grava e o worker.
    expect(r.body.checks.length).toBe(0);
  });
});

describe('idempotencia', () => {
  /**
   * O buraco que so apareceu rodando de verdade: cada `POST` criava auditoria
   * com id novo, logo `jobId` novo, e o BullMQ nao tinha como recusar. **Clique
   * duplo consumia dois creditos** — e o plano FREE tem tres.
   */
  it('pedir de novo com uma em andamento devolve a mesma', async () => {
    const primeiro = auditoriasCriadas[0]!;
    const r = await pedir<{ auditId: string; reaproveitada: boolean }>(alfa, '/audits', {
      leadId: leadComSite,
    });

    expect(r.status).toBe(201);
    expect(r.body.auditId).toBe(primeiro);
    // A tela precisa da diferenca entre "comecou" e "ja estamos medindo".
    expect(r.body.reaproveitada).toBe(true);
  });

  it('e nao consome credito', async () => {
    const antes = await creditosUsados(alfa.tenantId);
    await pedir(alfa, '/audits', { leadId: leadComSite });
    expect(await creditosUsados(alfa.tenantId)).toBe(antes);
  });

  it('nao cria linha nova no banco', async () => {
    const antes = await prisma.digitalPresenceAudit.count({
      where: { tenantId: alfa.tenantId, leadId: leadComSite },
    });
    await pedir(alfa, '/audits', { leadId: leadComSite });
    expect(
      await prisma.digitalPresenceAudit.count({
        where: { tenantId: alfa.tenantId, leadId: leadComSite },
      }),
    ).toBe(antes);
  });
});

describe('isolamento entre tenants', () => {
  it('lead de outro tenant nao existe para quem pede', async () => {
    const r = await pedir(beta, '/audits', { leadId: leadComSite });
    // 404 e nao 403: dizer "proibido" confirmaria que o id existe em algum
    // lugar. A chave composta faz a busca simplesmente nao encontrar.
    expect(r.status).toBe(404);
  });

  it('pedido cruzado nao consome credito do vizinho', async () => {
    const antes = await creditosUsados(beta.tenantId);
    await pedir(beta, '/audits', { leadId: leadComSite });
    expect(await creditosUsados(beta.tenantId)).toBe(antes);
  });

  it('auditoria de outro tenant nao e legivel', async () => {
    const id = auditoriasCriadas[0]!;
    const r = await pedir(beta, `/audits/${id}`);
    expect(r.status).toBe(404);
  });
});

describe('gate de plano', () => {
  it('sem saldo, o pedido e recusado com PLAN_LIMIT', async () => {
    // Esgota a cota do periodo pela borda do banco, como se o tenant tivesse
    // gasto tudo.
    const usage = await prisma.planUsage.findUniqueOrThrow({
      where: { tenantId_periodStart: { tenantId: alfa.tenantId, periodStart: inicioDoPeriodo() } },
    });
    const saldo = await pedir<{ incluidas: number }>(alfa, '/audits/quota');

    await prisma.planUsage.update({
      where: { id: usage.id },
      data: { auditsCount: saldo.body.incluidas },
    });

    const r = await pedir<{ code: string; capability: string }>(alfa, '/audits', {
      leadId: leadDoGate,
    });

    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PLAN_LIMIT');
    expect(r.body.capability).toBe('audit.run');
  });
});
