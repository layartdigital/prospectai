import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type {
  DashboardResponse,
  LeadListResponse,
  SessionResponse,
} from '@propectai/types';
import { fingerprintInput } from '@propectai/types';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Isolamento entre tenants na camada HTTP.
 *
 * Complementa tenant-isolation.spec.ts, que prova o isolamento no banco — por
 * índice composto e query direta. Este prova onde o TenantGuard de fato age:
 * uma requisição autenticada de verdade, atravessando guard, controller e
 * service, não pode enxergar dado de outro tenant.
 *
 * A lacuna entre os dois é real. Índice correto com query sem `where` de
 * tenant continua vazando; guard correto com índice ausente também. Só os dois
 * testes juntos cobrem o caminho inteiro.
 *
 * Sobe o AppModule em porta efêmera e usa `fetch` nativo — sem supertest, para
 * não acrescentar dependência a um teste que não precisa dela. Cookies são
 * manuseados à mão porque `fetch` não tem jar: é o que o navegador faria.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

/**
 * **Fixtures pelo papel que ignora a politica** — trocado em 03/09, junto com a
 * familia 5 (Leads nucleo).
 *
 * Era `new PrismaClient()`, que conecta pelo `DATABASE_URL`. Funcionava porque
 * o dono do banco **hoje** e superusuario, e superusuario ignora RLS mesmo com
 * `FORCE`. Isso e consequencia da configuracao atual, nao escolha de desenho: o
 * dia em que o dono deixar de ser superusuario, o `beforeAll` abaixo passaria a
 * criar o lead e o `afterAll` a nao limpar nada — os dois em silencio.
 *
 * **Era o ultimo `new PrismaClient()` do repositorio.** Os outros dois
 * (`tenant-isolation.spec.ts` e `business-invariants.spec.ts`) sairam na
 * familia 3.
 *
 * O que este arquivo prova continua sendo provado pelo papel da aplicacao: as
 * assercoes sao todas requisicoes HTTP reais. O client abaixo so monta e
 * desmonta cenario — e montar cenario e operacao administrativa.
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
let leadDoAlfa = '';

// Boot do Nest + Prisma engine + Argon2 em dois registros. Nada disso é rápido
// no Windows, e o padrão do Jest derrubaria o hook antes de terminar.
const BOOT_TIMEOUT_MS = 60_000;

function fingerprint(name: string): string {
  return createHash('sha256')
    .update(fingerprintInput(name, null, null))
    .digest('hex');
}

/** Monta o header Cookie a partir do Set-Cookie da resposta, como o navegador. */
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
      // Mínimo de 10 caracteres, conforme RegisterDto.
      password: 'SenhaDeTeste123',
    }),
  });

  expect(response.status).toBe(201);

  const session = (await response.json()) as SessionResponse;
  expect(session.tenant).not.toBeNull();

  return {
    email,
    tenantId: session.tenant!.id,
    cookie: collectCookies(response),
  };
}

function asActor<T>(actor: Actor, path: string): Promise<{ status: number; body: T }> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    headers: { Cookie: actor.cookie },
  }).then(async (response) => ({
    status: response.status,
    body: (await response.json().catch(() => null)) as T,
  }));
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();

  // Mesma configuração do main.ts. Divergir aqui produziria um teste que passa
  // contra uma aplicação que não é a que roda em produção.
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
  // Porta 0: o SO escolhe uma livre. Fixar porta faria o teste falhar quando
  // a API de desenvolvimento estivesse no ar.
  await app.listen(0);

  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  alfa = await register('alfa');
  beta = await register('beta');

  // Popula apenas o Alfa. O Beta nasce e permanece vazio.
  const lead = await admin.lead.create({
    data: {
      tenantId: alfa.tenantId,
      name: `Empresa do Alfa ${suffix}`,
      fingerprint: fingerprint(`Empresa do Alfa ${suffix}`),
      websiteStatus: 'SEM_SITE',
    },
  });

  leadDoAlfa = lead.id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();

  // Cascade leva leads, memberships e estado de onboarding junto.
  await admin.tenant.deleteMany({
    where: { id: { in: [alfa?.tenantId, beta?.tenantId].filter(Boolean) as string[] } },
  });
  await admin.user.deleteMany({
    where: { email: { in: [alfa?.email, beta?.email].filter(Boolean) as string[] } },
  });

  await admin.$disconnect();
}, BOOT_TIMEOUT_MS);

describe('isolamento entre tenants pela API', () => {
  it('conta recém-criada não enxerga lead de outro tenant', async () => {
    const { status, body } = await asActor<LeadListResponse>(beta, '/leads');

    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('o dono enxerga o próprio lead', async () => {
    const { status, body } = await asActor<LeadListResponse>(alfa, '/leads');

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(leadDoAlfa);
  });

  it('conhecer o id do lead não dá acesso a ele', async () => {
    // O caso que mais importa: id vazado por log, print ou URL compartilhada
    // não pode virar leitura. A resposta é 404, não 403 — confirmar a
    // existência do recurso já seria informação.
    const { status } = await asActor(beta, `/leads/${leadDoAlfa}`);

    expect(status).toBe(404);
  });

  it('KPIs do dashboard não vazam contagem entre tenants', async () => {
    // Agregação é onde o `where` de tenant costuma ser esquecido: a lista tem
    // paginação para lembrar o desenvolvedor do escopo, o COUNT não tem nada.
    const beta_ = await asActor<DashboardResponse>(beta, '/dashboard');
    const alfa_ = await asActor<DashboardResponse>(alfa, '/dashboard');

    expect(beta_.status).toBe(200);
    expect(beta_.body.kpis.leadsFound).toBe(0);
    expect(beta_.body.kpis.withoutOwnWebsite).toBe(0);
    expect(beta_.body.funnel.every((stage) => stage.count === 0)).toBe(true);

    expect(alfa_.body.kpis.leadsFound).toBe(1);
  });

  it('sem sessão não há leitura', async () => {
    const response = await fetch(`${baseUrl}/api/v1/leads`);

    expect(response.status).toBe(401);
  });

  it('cookie de um tenant não serve para forjar outro no header', async () => {
    // x-tenant-id existe para quem tem mais de um workspace. O TenantGuard
    // precisa validar contra o Membership — aceitar o header como verdade
    // seria escalonamento horizontal com uma linha de curl.
    const response = await fetch(`${baseUrl}/api/v1/leads`, {
      headers: { Cookie: beta.cookie, 'x-tenant-id': alfa.tenantId },
    });

    expect([403, 404]).toContain(response.status);
  });
});
