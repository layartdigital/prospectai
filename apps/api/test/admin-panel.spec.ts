import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { AdminTenantList, SessionResponse } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Painel do provedor — a fronteira mais perigosa do sistema.
 *
 * O `AdminController` consulta sem filtro de tenant, o que em qualquer outro
 * lugar seria defeito grave. Aqui é o propósito, e a única coisa que separa
 * isso de um vazamento total é o `PlatformAdminGuard`.
 *
 * Dois grupos de asserção:
 *   - **A fronteira**: ser dono de workspace não dá acesso ao painel
 *   - **A suspensão**: bloqueia de verdade, não só grava data
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate`.
 */

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const SENHA = 'SenhaDeTeste123';

let app: INestApplication;
let baseUrl = '';

interface Ator {
  userId: string;
  email: string;
  cookie: string;
  tenantId: string;
}

let operador: Ator;
let comum: Ator;

const BOOT_TIMEOUT_MS = 60_000;

function cookiesDe(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

async function registrar(label: string): Promise<Ator> {
  const email = `${label}-${suffix}@teste.propectai.local`;

  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Usuário ${label}`,
      tenantName: `Admin ${label} ${suffix}`,
      email,
      password: SENHA,
    }),
  });

  expect(response.status).toBe(201);
  const session = (await response.json()) as SessionResponse;

  return {
    userId: session.user.id,
    email,
    cookie: cookiesDe(response),
    tenantId: session.tenant!.id,
  };
}

function como(ator: Ator, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: ator.cookie,
      ...init.headers,
    },
  });
}

/** Login novo: suspender revoga os refresh tokens, e o cookie antigo morre. */
async function reautenticar(ator: Ator): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ator.email, password: SENHA }),
  });
  return cookiesDe(response);
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

  operador = await registrar('operador');
  comum = await registrar('comum');

  // Promoção só existe fora da aplicação. O teste faz o que o script faz.
  await prisma.platformAdmin.create({
    data: { userId: operador.userId, note: 'teste automatizado' },
  });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();

  await prisma.tenant.deleteMany({
    where: { id: { in: [operador?.tenantId, comum?.tenantId].filter(Boolean) as string[] } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `-${suffix}@teste.propectai.local` } },
  });

  await prisma.$disconnect();
}, BOOT_TIMEOUT_MS);

describe('a fronteira do painel', () => {
  it('dono de workspace não é operador da plataforma', async () => {
    // A distinção que sustenta tudo: ser OWNER do próprio tenant não dá
    // acesso nenhum ao painel. Se isto passar a 200, qualquer cliente
    // enxerga todos os outros.
    const response = await como(comum, '/admin/tenants');
    expect(response.status).toBe(403);
  });

  it('sem sessão não há painel', async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/tenants`);
    expect(response.status).toBe(401);
  });

  it('o operador enxerga todos os tenants, inclusive os que não são dele', async () => {
    const response = await como(operador, '/admin/tenants');
    expect(response.status).toBe(200);

    const lista = (await response.json()) as AdminTenantList;
    const ids = lista.items.map((t) => t.id);

    expect(ids).toContain(operador.tenantId);
    expect(ids).toContain(comum.tenantId);
  });

  it('ser operador não dá acesso ao workspace alheio', async () => {
    // A separação vale nos dois sentidos. O operador vê o tenant do outro no
    // painel, mas não consegue ler os leads dele pelo produto.
    const response = await fetch(`${baseUrl}/api/v1/leads`, {
      headers: { Cookie: operador.cookie, 'x-tenant-id': comum.tenantId },
    });

    expect([403, 404]).toContain(response.status);
  });
});

describe('troca de plano', () => {
  it('exige motivo', async () => {
    const response = await como(operador, `/admin/tenants/${comum.tenantId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ planCode: 'PRO' }),
    });

    expect(response.status).toBe(400);
  });

  it('troca e registra em auditoria', async () => {
    const response = await como(operador, `/admin/tenants/${comum.tenantId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ planCode: 'PRO', reason: 'Contrato assinado' }),
    });
    expect(response.status).toBe(204);

    const registro = await prisma.auditLog.findFirst({
      where: { tenantId: comum.tenantId, action: 'admin.plan_changed' },
      orderBy: { createdAt: 'desc' },
    });

    // Sem o motivo no registro, "por que este cliente está em PRO" não tem
    // resposta daqui a seis meses.
    expect(registro).not.toBeNull();
    expect(JSON.stringify(registro?.after)).toContain('Contrato assinado');
  });
});

describe('suspensão', () => {
  it('bloqueia o acesso ao produto de verdade', async () => {
    const antes = await fetch(`${baseUrl}/api/v1/leads`, {
      headers: { Cookie: comum.cookie },
    });
    expect(antes.status).toBe(200);

    const suspender = await como(operador, `/admin/tenants/${comum.tenantId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Inadimplência de teste' }),
    });
    expect(suspender.status).toBe(204);

    // Sessão nova, porque suspender revoga os refresh tokens. Mesmo assim o
    // acesso precisa cair — suspensão que só grava data é anotação no painel,
    // e o inadimplente segue usando o produto.
    const cookieNovo = await reautenticar(comum);
    const depois = await fetch(`${baseUrl}/api/v1/leads`, {
      headers: { Cookie: cookieNovo },
    });

    expect(depois.status).toBe(403);

    const corpo = (await depois.json()) as { code?: string };
    expect(corpo.code).toBe('TENANT_SUSPENDED');
  });

  it('reativar devolve o acesso', async () => {
    const reativar = await como(
      operador,
      `/admin/tenants/${comum.tenantId}/reactivate`,
      { method: 'POST' },
    );
    expect(reativar.status).toBe(204);

    const cookieNovo = await reautenticar(comum);
    const response = await fetch(`${baseUrl}/api/v1/leads`, {
      headers: { Cookie: cookieNovo },
    });

    expect(response.status).toBe(200);
  });

  it('suspender exige motivo', async () => {
    const response = await como(operador, `/admin/tenants/${comum.tenantId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });
});
