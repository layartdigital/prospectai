import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { PrivacyService } from '../src/privacy/privacy.service';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Eliminação do ator no log de auditoria — decisão D4.
 *
 * As três propriedades que a decisão promete, e nenhuma delas é óbvia sozinha:
 *
 *   1. **o evento sobrevive** — senão teríamos escolhido apagar a linha;
 *   2. **o identificador some** — senão não teríamos eliminado nada;
 *   3. **duas ações da mesma pessoa continuam agrupáveis** — é o que separa
 *      pseudonimizar de simplesmente anular o campo, e é a razão de não
 *      bastar o `onDelete: SetNull` que o schema já tinha.
 *
 * A terceira é a que justifica a coluna existir. Sem ela, `SetNull` resolveria.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 */

const admin = criarPrismaAdmin();
const sufixo = Date.now().toString(36);
const TIMEOUT_MS = 60_000;

let app: INestApplication;
let privacy: PrivacyService;

let tenantId = '';
let usuarioId = '';
let outroUsuarioId = '';

beforeAll(async () => {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication();
  await app.init();
  privacy = app.get(PrivacyService);

  const t = await admin.tenant.create({
    data: { name: `Tenant Privacy ${sufixo}`, slug: `privacy-${sufixo}`, isDemo: true },
  });
  tenantId = t.id;

  const u = await admin.user.create({
    data: { email: `sai-${sufixo}@exemplo.test`, name: 'Quem Sai', passwordHash: 'x' },
  });
  usuarioId = u.id;

  const outro = await admin.user.create({
    data: { email: `fica-${sufixo}@exemplo.test`, name: 'Quem Fica', passwordHash: 'x' },
  });
  outroUsuarioId = outro.id;

  // Duas ações da pessoa que sai, e uma de outra pessoa no mesmo tenant. A
  // terceira é o controle: se ela for tocada, a varredura está larga demais.
  await admin.auditLog.createMany({
    data: [
      { tenantId, actorId: usuarioId, action: 'plan.changed', entityType: 'Tenant', entityId: tenantId },
      { tenantId, actorId: usuarioId, action: 'audit.presence.requested', entityType: 'DigitalPresenceAudit', entityId: 'x' },
      { tenantId, actorId: outroUsuarioId, action: 'team.member_invited', entityType: 'Membership', entityId: 'y' },
    ],
  });
}, TIMEOUT_MS);

afterAll(async () => {
  if (tenantId) await admin.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await admin.user.deleteMany({ where: { id: { in: [usuarioId, outroUsuarioId] } } }).catch(() => {});
  await admin.$disconnect();
  await app.close();
}, TIMEOUT_MS);

describe('anonimizarAtor', () => {
  it('substitui o ator nas linhas dele, e só nelas', async () => {
    const resultado = await privacy.anonimizarAtor(usuarioId);

    expect(resultado.linhas).toBe(2);
    expect(resultado.pseudonimo).toMatch(/^usuario-removido-[0-9a-f]{8}$/);

    // Controle: a linha da outra pessoa não foi tocada.
    const daOutra = await admin.auditLog.findFirstOrThrow({
      where: { tenantId, actorId: outroUsuarioId },
    });
    expect(daOutra.actorPseudonym).toBeNull();
  });

  it('o evento sobrevive — ação, data e efeito continuam lá', async () => {
    const linhas = await admin.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });

    // As três continuam existindo. Nenhuma foi apagada.
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => l.action).sort()).toEqual([
      'audit.presence.requested',
      'plan.changed',
      'team.member_invited',
    ]);
  });

  it('o identificador some', async () => {
    const restaram = await admin.auditLog.count({ where: { actorId: usuarioId } });
    expect(restaram).toBe(0);
  });

  it('as duas ações da mesma pessoa continuam agrupáveis', async () => {
    /**
     * **Esta é a propriedade que justifica a coluna.**
     *
     * O schema já tinha `onDelete: SetNull` no ator: apagar o `User` anularia
     * o `actorId` sozinho, e o registro sobreviveria. Mas a identidade sumiria
     * por inteiro, e com ela a capacidade de responder "o que aquela mesma
     * pessoa fez antes de sair" — que é justamente a pergunta de quem investiga
     * um incidente depois.
     */
    const anonimas = await admin.auditLog.findMany({
      where: { tenantId, actorPseudonym: { not: null } },
    });

    expect(anonimas).toHaveLength(2);
    const rotulos = new Set(anonimas.map((l) => l.actorPseudonym));
    expect(rotulos.size).toBe(1);
  });

  it('chamar de novo nao reescreve o rotulo ja atribuido', async () => {
    // O `actorId` é anulado no mesmo comando que grava o pseudônimo, então a
    // segunda chamada não encontra linha nenhuma. Zero é a resposta certa.
    const antes = await admin.auditLog.findFirstOrThrow({
      where: { tenantId, actorPseudonym: { not: null } },
    });

    const segunda = await privacy.anonimizarAtor(usuarioId);
    expect(segunda.linhas).toBe(0);

    const depois = await admin.auditLog.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.actorPseudonym).toBe(antes.actorPseudonym);
  });
});
