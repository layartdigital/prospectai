import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { SessionResponse } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * O que a suspensão bloqueia — `lacunas-estruturais.md` §10.4.
 *
 * **Suspenso perde o que gasta e mantém o que é dele.** A metade "mantém" é a
 * que precisa de teste: bloquear tudo é o comportamento fácil, acontece por
 * omissão, e transforma cobrança em retenção de dado do cliente — que colide
 * com portabilidade (LGPD art. 18, GDPR art. 20) e é hostil.
 *
 * Sem estes testes, um `if` a mais em qualquer guard reverte a decisão sem
 * quebrar nada visível.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `pnpm db:seed`.
 */

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const SENHA = 'SenhaDeTeste123';
const BOOT_TIMEOUT_MS = 60_000;

let app: INestApplication;
let baseUrl = '';
let cookie = '';
let tenantId = '';

function cookiesDe(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

function como(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init.headers },
  });
}

async function suspender(): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { suspendedAt: new Date(), suspendedReason: 'billing:inadimplencia' },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
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

  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Dono Suspenso',
      tenantName: `Suspenso ${suffix}`,
      email: `suspenso-${suffix}@teste.propectai.local`,
      password: SENHA,
    }),
  });

  expect(response.status).toBe(201);

  const session = (await response.json()) as SessionResponse;
  cookie = cookiesDe(response);
  tenantId = session.tenant!.id;

  // O plano precisa permitir exportação: FREE tem `exportFormats: []`, e um
  // 403 do gate de plano seria confundido com 403 da suspensão.
  const plano = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
  await prisma.subscription.upsert({
    where: { tenantId },
    create: { tenantId, planId: plano.id, status: 'ACTIVE' },
    update: { planId: plano.id, status: 'ACTIVE' },
  });

  await suspender();
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({
    where: { email: `suspenso-${suffix}@teste.propectai.local` },
  });
  await prisma.$disconnect();
});

describe('suspenso mantém o que é dele', () => {
  it('lê os próprios leads', async () => {
    const response = await como('/leads');
    expect(response.status).toBe(200);
  });

  it('exporta em CSV', async () => {
    // A rota que materializa a portabilidade. Bloqueá-la seria exatamente a
    // alavanca de cobrança que a decisão recusa: "pague para levar seus dados".
    const response = await como('/leads/export');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('csv');
  });

  it('vê o painel e o próprio saldo', async () => {
    const [dashboard, quota] = await Promise.all([
      como('/dashboard'),
      como('/prospecting/quota'),
    ]);

    expect(dashboard.status).toBe(200);
    // Consultar o saldo é leitura. Saber quanto sobrou é justamente o que a
    // pessoa precisa para decidir se vale voltar.
    expect(quota.status).toBe(200);
  });
});

describe('suspenso perde o que gasta', () => {
  it('não cria busca nova', async () => {
    const response = await como('/prospecting/searches', {
      method: 'POST',
      body: JSON.stringify({
        niche: 'Dentistas',
        city: 'São Paulo',
        stateUf: 'SP',
        requestedCount: 10,
        radiusKm: 10,
      }),
    });

    expect(response.status).toBe(403);

    const corpo = (await response.json()) as { message?: { code?: string } | string };
    expect(JSON.stringify(corpo)).toContain('TENANT_SUSPENDED');
  });

  it('não move card no pipeline', async () => {
    // Escrita qualquer. Serve para provar que a regra é o método HTTP e não
    // uma lista de rotas — nada em `prospecting` foi citado nominalmente.
    const response = await como('/leads/id-inexistente/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ dueAt: new Date().toISOString(), note: 'teste' }),
    });

    // 403 e não 404: o guard decide antes de o handler procurar o lead.
    expect(response.status).toBe(403);
  });

  it('não abre segmento, que é GET mas dispara IA', async () => {
    // O furo que o método HTTP sozinho deixaria passar, coberto por
    // `@ConsomeRecurso()`. Sem ele, workspace inadimplente queimaria orçamento
    // de Gemini só navegando.
    const response = await como('/segments/id-inexistente');

    expect(response.status).toBe(403);
  });
});

describe('a suspensão é reversível pela via normal', () => {
  it('sair da suspensão devolve a escrita', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { suspendedAt: null, suspendedReason: null },
    });

    const response = await como('/leads/id-inexistente/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ dueAt: new Date().toISOString(), note: 'teste' }),
    });

    // Agora quem responde é a aplicação, não o guard. O código exato depende
    // da validação do corpo e não é o que este teste afirma: o que se prova é
    // que **deixou de ser 403**, ou seja, que a suspensão não deixou resíduo.
    expect(response.status).not.toBe(403);
  });
});
