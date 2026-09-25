import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { conferirLimpeza } from './limpeza';
import { criarPrismaAdmin } from './prisma-admin';
import { ACAO_ROTACAO, rotacionarSenha } from '../../../prisma/lib/rotacionar-senha';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * A rotacao operacional de senha: uma transacao, tres escritas.
 *
 * O import de `prisma/lib` **existe so aqui**. Nenhum codigo de producao de
 * `apps/api` importa daquele diretorio — a unica consumidora em producao e a
 * CLI. O teste importa para poder injetar falha de verdade na ultima escrita,
 * que e a unica forma honesta de provar o rollback.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `pnpm db:seed`.
 */

const prisma = criarPrismaAdmin();
const suffix = Date.now().toString(36);
const RAIZ = path.resolve(__dirname, '../../..');
const BOOT_TIMEOUT_MS = 60_000;

const SENHA_ANTIGA = 'SenhaAntiga123';
const SENHA_NOVA = 'SenhaNovaDeTeste456';
const EMAIL = `rotacao-${suffix}@teste.propectai.local`;
const EMAIL_VIZINHO = `vizinho-${suffix}@teste.propectai.local`;

let app: INestApplication;
let baseUrl = '';
let userId = '';
let vizinhoId = '';
let tenantId = '';
let tenantVizinho = '';

interface SaidaDaCli {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Roda a CLI de verdade, com a senha entrando pelo stdin.
 *
 * `spawn` e nao `execFile`: so assim da para escrever no stdin do processo, que
 * e justamente o que este teste precisa exercitar. A senha nunca vai em
 * `argv` — se fosse, apareceria no `ps` de qualquer processo da maquina.
 */
function rodarCli(args: readonly string[], segredo: string): Promise<SaidaDaCli> {
  return new Promise((resolve, reject) => {
    const processo = spawn('node', ['--import', 'tsx', 'prisma/set-senha.ts', ...args], {
      cwd: RAIZ,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    processo.stdout.setEncoding('utf8');
    processo.stderr.setEncoding('utf8');
    processo.stdout.on('data', (pedaco: string) => (stdout += pedaco));
    processo.stderr.on('data', (pedaco: string) => (stderr += pedaco));
    processo.on('error', reject);
    processo.on('close', (code) => resolve({ code, stdout, stderr }));

    processo.stdin.end(segredo);
  });
}

function cookiesDe(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

async function registrar(email: string, nome: string): Promise<{ tenantId: string; userId: string }> {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, tenantName: nome, email, password: SENHA_ANTIGA }),
  });

  expect(response.status).toBe(201);
  const sessao = (await response.json()) as { tenant?: { id: string } };
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  return { tenantId: sessao.tenant!.id, userId: user.id };
}

function login(email: string, senha: string) {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.init();
  await app.listen(0);

  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  ({ tenantId, userId } = await registrar(EMAIL, `Rotacao ${suffix}`));
  ({ tenantId: tenantVizinho, userId: vizinhoId } = await registrar(EMAIL_VIZINHO, `Vizinho ${suffix}`));
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [userId, vizinhoId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantVizinho] } } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, EMAIL_VIZINHO] } } });

  const sobras = await conferirLimpeza(prisma, suffix);
  await prisma.$disconnect();

  if (sobras !== null) throw new Error(sobras);
});

describe('a rotacao, quando tudo da certo', () => {
  let cookieAntigo = '';

  it('a sessao anterior existe antes de girar a senha', async () => {
    const response = await login(EMAIL, SENHA_ANTIGA);
    expect(response.status).toBe(200);
    cookieAntigo = cookiesDe(response);

    const validos = await prisma.refreshToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(validos).toBeGreaterThan(0);
  });

  it('gira a senha e devolve quantas sessoes caíram', async () => {
    const resultado = await rotacionarSenha(prisma, {
      email: EMAIL,
      senhaNova: SENHA_NOVA,
      motivo: 'teste de rotacao',
      origem: 'teste',
    });

    expect(resultado.userId).toBe(userId);
    expect(resultado.sessoesRevogadas).toBeGreaterThan(0);
  });

  it('a senha antiga deixa de entrar, e a nova entra', async () => {
    expect((await login(EMAIL, SENHA_ANTIGA)).status).toBe(401);
    expect((await login(EMAIL, SENHA_NOVA)).status).toBe(200);
  });

  it('o refresh anterior a rotacao e recusado', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookieAntigo },
    });

    expect(response.status).toBe(401);
  });

  it('nenhuma sessao de OUTRO usuario foi tocada', async () => {
    const vizinho = await login(EMAIL_VIZINHO, SENHA_ANTIGA);
    expect(vizinho.status).toBe(200);

    const abertosDoVizinho = await prisma.refreshToken.count({
      where: { userId: vizinhoId, revokedAt: null },
    });
    expect(abertosDoVizinho).toBeGreaterThan(0);
  });
});

describe('a trilha do evento: global, e sem segredo', () => {
  it('nasce com tenantId nulo e entityType User', async () => {
    const trilha = await prisma.auditLog.findFirstOrThrow({
      where: { action: ACAO_ROTACAO, entityId: userId },
      orderBy: { createdAt: 'desc' },
    });

    expect(trilha.tenantId).toBeNull();
    expect(trilha.entityType).toBe('User');
    expect(trilha.actorId).toBeNull();
    expect(trilha.after).toMatchObject({ motivo: 'teste de rotacao', origem: 'teste' });
  });

  it('nao carrega senha nem hash em lugar nenhum do registro', async () => {
    const trilha = await prisma.auditLog.findFirstOrThrow({
      where: { action: ACAO_ROTACAO, entityId: userId },
      orderBy: { createdAt: 'desc' },
    });

    const serializado = JSON.stringify({ before: trilha.before, after: trilha.after });

    expect(serializado).not.toContain(SENHA_NOVA);
    expect(serializado).not.toContain(SENHA_ANTIGA);
    expect(serializado).not.toContain('$argon2');
    expect(serializado.toLowerCase()).not.toContain('hash');
  });

  it('e invisivel a uma leitura com escopo de tenant — GLOBAL SECURITY AUDIT', async () => {
    const visiveis = await prisma.auditLog.count({
      where: { action: ACAO_ROTACAO, entityId: userId, tenantId: { not: null } },
    });

    expect(visiveis).toBe(0);
  });
});

describe('falha na ultima escrita desfaz as anteriores', () => {
  it('rollback completo: senha nao muda e nenhuma sessao e revogada', async () => {
    const cookie = cookiesDe(await login(EMAIL, SENHA_NOVA));
    expect(cookie).not.toBe('');

    const antes = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const abertosAntes = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    const trilhasAntes = await prisma.auditLog.count({
      where: { action: ACAO_ROTACAO, entityId: userId },
    });

    await expect(
      rotacionarSenha(
        prisma,
        {
          email: EMAIL,
          senhaNova: 'SenhaQueNaoDeveriaValer789',
          motivo: 'falha provocada',
          origem: 'teste',
        },
        {
          antesDaTrilha: () => {
            throw new Error('falha provocada na trilha');
          },
        },
      ),
    ).rejects.toThrow('falha provocada');

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const abertosDepois = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    const trilhasDepois = await prisma.auditLog.count({
      where: { action: ACAO_ROTACAO, entityId: userId },
    });

    expect(depois.passwordHash).toBe(antes.passwordHash);
    expect(abertosDepois).toBe(abertosAntes);
    expect(trilhasDepois).toBe(trilhasAntes);

    // E a prova que importa para quem usa: a senha nova falhou, a anterior vale.
    expect((await login(EMAIL, 'SenhaQueNaoDeveriaValer789')).status).toBe(401);
    expect((await login(EMAIL, SENHA_NOVA)).status).toBe(200);
  });
});

describe('a CLI: stdin, codigo de saida e nenhum segredo na saida', () => {
  const SENHA_VIA_CLI = 'SenhaPelaLinhaDeComando987';

  it('le a senha do cano, troca a senha, e nao imprime o segredo', async () => {
    const saida = await rodarCli([EMAIL, 'rotacao pela CLI'], `${SENHA_VIA_CLI}\n`);

    expect(saida.code).toBe(0);
    expect(saida.stdout).toContain('Senha trocada');
    expect(saida.stdout).not.toContain(SENHA_VIA_CLI);
    expect(saida.stderr).not.toContain(SENHA_VIA_CLI);

    expect((await login(EMAIL, SENHA_VIA_CLI)).status).toBe(200);
  }, BOOT_TIMEOUT_MS);

  it('sem e-mail e motivo: explica o uso e sai com codigo 1', async () => {
    const saida = await rodarCli([], '');

    expect(saida.code).toBe(1);
    expect(saida.stdout).toContain('Uso:');
  }, BOOT_TIMEOUT_MS);

  it('senha curta: recusa, sai com codigo 1 e nao repete o segredo no erro', async () => {
    const saida = await rodarCli([EMAIL, 'senha curta'], 'curta\n');

    expect(saida.code).toBe(1);
    expect(saida.stderr + saida.stdout).toContain('12 caracteres');
    expect(saida.stderr + saida.stdout).not.toContain('curta\n');
  }, BOOT_TIMEOUT_MS);
});
