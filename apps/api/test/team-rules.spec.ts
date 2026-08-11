import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { InvitationView, SessionResponse, TeamView } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Regras de equipe — as que, se falharem, quebram o produto de formas
 * irrecuperáveis.
 *
 * Três categorias:
 *   - **Escalada de privilégio**: conceder papel acima do próprio
 *   - **Workspace órfão**: remover ou rebaixar o último dono
 *   - **Furo de plano**: convidar além dos assentos
 *
 * As duas primeiras não têm conserto pela interface depois de acontecerem, e
 * é por isso que valem teste antes de existir o primeiro cliente.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate`.
 */

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const SENHA = 'SenhaDeTeste123';

let app: INestApplication;
let baseUrl = '';

interface Ator {
  email: string;
  cookie: string;
  tenantId: string;
}

let dono: Ator;

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
      tenantName: `Equipe ${label} ${suffix}`,
      email,
      password: SENHA,
    }),
  });

  expect(response.status).toBe(201);
  const session = (await response.json()) as SessionResponse;

  return { email, cookie: cookiesDe(response), tenantId: session.tenant!.id };
}

function comoDono(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: dono.cookie,
      ...init.headers,
    },
  });
}

/** O plano do tenant precisa mudar para exercitar os assentos. */
async function definirPlano(tenantId: string, code: 'FREE' | 'PRO'): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code } });
  await prisma.subscription.upsert({
    where: { tenantId },
    create: { tenantId, planId: plan.id, status: 'ACTIVE' },
    update: { planId: plan.id, status: 'ACTIVE' },
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

  dono = await registrar('dono');
  await definirPlano(dono.tenantId, 'PRO');
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();

  if (dono?.tenantId) {
    await prisma.tenant.deleteMany({ where: { id: dono.tenantId } });
  }
  await prisma.user.deleteMany({
    where: { email: { contains: `-${suffix}@teste.propectai.local` } },
  });

  await prisma.$disconnect();
}, BOOT_TIMEOUT_MS);

describe('workspace recém-criado', () => {
  it('nasce com um membro e nenhum convite', async () => {
    const response = await comoDono('/team');
    expect(response.status).toBe(200);

    const team = (await response.json()) as TeamView;
    expect(team.members).toHaveLength(1);
    expect(team.members[0]?.role).toBe('OWNER');
    expect(team.invitations).toHaveLength(0);
    expect(team.seatsUsed).toBe(1);
  });
});

describe('escalada de privilégio', () => {
  it('o dono não pode convidar outro dono pela API', async () => {
    // OWNER convidando OWNER passaria na regra de hierarquia, mas o DTO só
    // aceita papéis atribuíveis. É trava dupla de propósito: a interface não
    // oferece, e a API recusa mesmo se alguém montar a requisição à mão.
    const response = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `x-${suffix}@teste.local`, role: 'SUPERUSER' }),
    });

    expect(response.status).toBe(400);
  });

  it('quem tem papel menor não concede papel maior', async () => {
    // Convida um ADMIN e faz ele tentar promover alguém a OWNER.
    const criado = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `admin-${suffix}@teste.local`, role: 'ADMIN' }),
    });
    expect(criado.status).toBe(201);

    const convite = (await criado.json()) as InvitationView;
    const token = convite.acceptUrl!.split('/invite/')[1]!;

    const aceite = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: 'Admin Teste', password: SENHA }),
    });
    expect(aceite.status).toBe(200);

    const cookieAdmin = cookiesDe(aceite);

    // O ADMIN tenta se promover a OWNER. Se isto passar, dois requests
    // separam qualquer convidado do controle total do workspace.
    const team = (await (await comoDono('/team')).json()) as TeamView;
    const membroAdmin = team.members.find((m) => m.role === 'ADMIN');
    expect(membroAdmin).toBeDefined();

    const promocao = await fetch(
      `${baseUrl}/api/v1/team/members/${membroAdmin!.membershipId}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin },
        body: JSON.stringify({ role: 'OWNER' }),
      },
    );

    expect(promocao.status).toBe(403);
  });
});

describe('workspace órfão', () => {
  it('o último dono não pode ser removido', async () => {
    const team = (await (await comoDono('/team')).json()) as TeamView;
    const donoMembro = team.members.find((m) => m.role === 'OWNER')!;

    const response = await comoDono(`/team/members/${donoMembro.membershipId}`, {
      method: 'DELETE',
    });

    // Sem dono não há quem mude plano, convide ou remova — e a interface não
    // oferece caminho de volta.
    expect(response.status).toBe(400);
  });

  it('o último dono não pode ser rebaixado', async () => {
    const team = (await (await comoDono('/team')).json()) as TeamView;
    const donoMembro = team.members.find((m) => m.role === 'OWNER')!;

    const response = await comoDono(`/team/members/${donoMembro.membershipId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'VIEWER' }),
    });

    expect(response.status).toBe(400);
  });
});

describe('assentos do plano', () => {
  it('convite pendente ocupa assento', async () => {
    const antes = (await (await comoDono('/team')).json()) as TeamView;

    const criado = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `pendente-${suffix}@teste.local`, role: 'SDR' }),
    });
    expect(criado.status).toBe(201);

    const depois = (await (await comoDono('/team')).json()) as TeamView;

    // Sem esta contagem, mil convites furam o limite sem ninguém ter entrado.
    expect(depois.seatsUsed).toBe(antes.seatsUsed + 1);
  });

  it('o mesmo e-mail não recebe dois convites pendentes', async () => {
    const repetido = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `pendente-${suffix}@teste.local`, role: 'SDR' }),
    });

    expect(repetido.status).toBe(409);
  });

  it('o limite do plano bloqueia o convite na tentativa', async () => {
    // FREE inclui 1 usuário, e o workspace já tem dono e convidados.
    await definirPlano(dono.tenantId, 'FREE');

    const response = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `excedente-${suffix}@teste.local`, role: 'SDR' }),
    });

    expect(response.status).toBe(403);

    const corpo = (await response.json()) as { code?: string };
    expect(corpo.code).toBe('PLAN_LIMIT');

    await definirPlano(dono.tenantId, 'PRO');
  });
});

describe('aceite de convite', () => {
  it('token inválido não revela nada', async () => {
    const response = await fetch(`${baseUrl}/api/v1/invitations/token-que-nao-existe`);
    expect(response.status).toBe(404);
  });

  it('conta existente exige a senha correta', async () => {
    const outro = await registrar('outro');

    const criado = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: outro.email, role: 'SDR' }),
    });
    expect(criado.status).toBe(201);

    const convite = (await criado.json()) as InvitationView;
    const token = convite.acceptUrl!.split('/invite/')[1]!;

    // Senha errada: é o que impede alguém de posse do link anexar um
    // workspace à conta de outra pessoa.
    const errada = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'SenhaErradaDeProposito' }),
    });
    expect(errada.status).toBe(403);

    const certa = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: SENHA }),
    });
    expect(certa.status).toBe(200);

    await prisma.tenant.deleteMany({ where: { id: outro.tenantId } });
  });

  it('convite já aceito não serve de novo', async () => {
    const criado = await comoDono('/team/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `duplo-${suffix}@teste.local`, role: 'VIEWER' }),
    });
    const convite = (await criado.json()) as InvitationView;
    const token = convite.acceptUrl!.split('/invite/')[1]!;

    const primeiro = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: 'Duplo', password: SENHA }),
    });
    expect(primeiro.status).toBe(200);

    const segundo = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: 'Duplo', password: SENHA }),
    });
    expect(segundo.status).toBe(404);
  });
});
