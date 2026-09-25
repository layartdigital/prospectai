import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SessionResponse } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { conferirLimpeza } from './limpeza';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * O que uma conta desabilitada ainda consegue fazer, e o que acontece quando
 * duas requisicoes disputam o mesmo refresh token.
 *
 * Medido no GATE S0 (25/09/2026): `isActive` era verificado **so** no login.
 * Quem tivesse refresh token valido renovava para sempre, com sete dias novos a
 * cada rotacao — desativar conta nao expulsava ninguem.
 *
 * E a rotacao lia o token, emitia o substituto e so entao revogava o antigo:
 * duas requisicoes simultaneas liam a mesma linha como valida e **ambas**
 * emitiam descendente.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `pnpm db:seed`.
 */

const prisma = criarPrismaAdmin();
const suffix = Date.now().toString(36);
const SENHA = 'SenhaDeTeste123';
const BOOT_TIMEOUT_MS = 60_000;
const EMAIL = `sessao-${suffix}@teste.propectai.local`;

let app: INestApplication;
let baseUrl = '';
let userId = '';
let tenantId = '';

function cookiesDe(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

function chamar(caminho: string, cookie: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/v1${caminho}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init.headers },
  });
}

async function entrar(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });

  expect(response.status).toBe(200);
  return cookiesDe(response);
}

async function desativar(valor: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { isActive: valor } });
}

/**
 * Zera as sessoes do usuario antes de contar.
 *
 * Sem isto, `count` fala do usuario inteiro e nao do que o teste criou: os
 * testes anteriores deste arquivo deixam tokens abertos, e a contagem vira
 * numero sem significado. Foi o que derrubou as duas primeiras versoes destes
 * dois testes — **falha do teste, nao do codigo**.
 */
async function zerarSessoes(): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function validos(): Promise<number> {
  return prisma.refreshToken.count({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
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
      name: 'Dono da Sessao',
      tenantName: `Sessao ${suffix}`,
      email: EMAIL,
      password: SENHA,
    }),
  });

  expect(response.status).toBe(201);

  const sessao = (await response.json()) as SessionResponse;
  tenantId = sessao.tenant!.id;
  userId = (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const sobras = await conferirLimpeza(prisma, suffix);
  await prisma.$disconnect();

  if (sobras !== null) throw new Error(sobras);
});

describe('conta desabilitada nao renova credencial', () => {
  afterEach(async () => {
    await desativar(true);
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: null } });
  });

  it('desativada no meio da sessao: o refresh e recusado', async () => {
    const cookie = await entrar();
    await desativar(false);

    const response = await chamar('/auth/refresh', cookie, { method: 'POST' });

    expect(response.status).toBe(401);
  });

  it('apagada no meio da sessao: o refresh e recusado', async () => {
    const cookie = await entrar();
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    const response = await chamar('/auth/refresh', cookie, { method: 'POST' });

    expect(response.status).toBe(401);
  });

  it('desativada: `/auth/me` deixa de responder a sessao', async () => {
    const cookie = await entrar();
    await desativar(false);

    const response = await chamar('/auth/me', cookie);

    expect(response.status).toBe(401);
  });

  it('o login recusa com a MESMA mensagem de senha errada', async () => {
    await desativar(false);

    const inativa = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: SENHA }),
    });
    const senhaErrada = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'senha-que-nao-e-a-dela' }),
    });

    expect(inativa.status).toBe(401);
    expect(senhaErrada.status).toBe(401);
    expect(await inativa.json()).toEqual(await senhaErrada.json());
  });

  it('desativada: a sessao continua REVOGAVEL — logout funciona', async () => {
    await zerarSessoes();
    const cookie = await entrar();
    expect(await validos()).toBe(1);

    await desativar(false);

    const response = await chamar('/auth/logout', cookie, { method: 'POST' });

    expect(response.status).toBe(204);
    expect(await validos()).toBe(0);
  });
});

describe('duas requisicoes disputando o mesmo refresh token', () => {
  it('exatamente uma vence; a outra recebe 401; um so descendente fica valido', async () => {
    await zerarSessoes();
    const cookie = await entrar();
    expect(await validos()).toBe(1);

    const [a, b] = await Promise.all([
      chamar('/auth/refresh', cookie, { method: 'POST' }),
      chamar('/auth/refresh', cookie, { method: 'POST' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 401]);

    // O token da sessao foi consumido (revogado) e um descendente nasceu.
    // Continua sendo 1. Com o defeito, nasceriam dois: a conta daria 2.
    expect(await validos()).toBe(1);
  });

  afterAll(zerarSessoes);
});

describe('JWT_REFRESH_TTL deixou de ser decorativo', () => {
  it('o prazo do refresh sai da variavel, e nao dos 7 dias fixos', async () => {
    const antes = Date.now();
    await entrar();

    const token = await prisma.refreshToken.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const esperadoSegundos = Number(process.env.JWT_REFRESH_TTL?.replace('d', '') ?? 7) * 86_400;
    const observadoSegundos = (token.expiresAt.getTime() - antes) / 1000;

    // Tolerancia de um minuto: entre o `antes` e a escrita ha o custo do login.
    expect(Math.abs(observadoSegundos - esperadoSegundos)).toBeLessThan(60);
  });
});
