import { createHash } from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaApp } from '../src/db/prisma-app';
import { criarPrismaSistema } from '../src/db/prisma-sistema';
import { AVISO_ANTECEDENCIA_DIAS, chaveDeAviso } from '../src/pipeline/audit-decisoes';
import { avisarExpiracao } from '../src/pipeline/avisar-expiracao';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Aviso de expiracao — D6, peca 3. Prova contra o banco.
 *
 * Precisa de `pnpm docker:up` e `pnpm db:migrate` antes.
 *
 * ---
 *
 * **Tres clients, e cada um esta aqui por um motivo diferente.**
 *
 * - `admin` monta o cenario e confere o resultado, ignorando RLS. Montar
 *   cenario e operacao administrativa; submete-la a politica que se quer testar
 *   nao provaria nada e quebraria tudo.
 * - `sistema` e `app` sao **os mesmos que o `index.ts` passa em producao**. Nao
 *   ha dublê: o que se mede aqui e a funcao com os papeis de verdade.
 *
 * **O que este arquivo consegue e o que nao consegue falsificar.** Criando
 * auditorias vencendo em DOIS tenants e exigindo aviso nos dois, ele reprova o
 * erro perigoso — trocar o `sistema` pelo `app` na enumeracao dos tenants, que
 * devolveria zero linhas sem erro nenhum e faria o job passar todo dia sem
 * avisar ninguem. O que ele **nao** distingue e `sistema` de dono: se o
 * `DATABASE_URL_SISTEMA` faltar, o fallback conecta como dono, que tambem
 * enxerga todos os tenants, e o teste passa. Isso e privilegio a mais, nao
 * ausencia de aviso, e o `prisma-sistema.ts` grita quando acontece.
 *
 * **Ele ja se pagou antes de entrar no repositorio.** A primeira versao do job
 * fazia a descoberta inteira com o papel do sistema, e esta suite a derrubou na
 * primeira execucao com `42501 permission denied` — o desenho da migration
 * `rls_papel_sistema_estreitar` recusando um alargamento que eu nao tinha
 * percebido estar propondo.
 */

const admin = criarPrismaAdmin();
const sistema = criarPrismaSistema();
const app = criarPrismaApp();

const sufixo = Date.now().toString(36);
const TIMEOUT_HOOK_MS = 60_000;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Dentro da janela dos 15 dias. */
const PERTO_DIAS = 5;
/** Fora dela, e por larga margem — para nenhum arredondamento aproximar. */
const LONGE_DIAS = 100;

let tenantA = '';
let tenantB = '';
let auditoriaPerto = '';
let auditoriaLonge = '';
let auditoriaDoVizinho = '';

const agora = new Date();
const dataPerto = new Date(agora.getTime() + PERTO_DIAS * DIA_MS);
const dataLonge = new Date(agora.getTime() + LONGE_DIAS * DIA_MS);

function comoOAvisoEscreve(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function criarTenant(rotulo: string): Promise<string> {
  const t = await admin.tenant.create({
    data: {
      name: `Tenant Aviso ${rotulo} ${sufixo}`,
      slug: `aviso-${rotulo}-${sufixo}`,
      isDemo: true,
    },
  });
  return t.id;
}

async function criarLead(tenantId: string, rotulo: string): Promise<string> {
  const lead = await admin.lead.create({
    data: {
      tenantId,
      name: `Negocio ${rotulo} ${sufixo}`,
      website: 'https://exemplo.invalid',
      fingerprint: createHash('sha256').update(`${tenantId}-${rotulo}-${sufixo}`).digest('hex'),
    },
  });
  return lead.id;
}

/**
 * Cria uma auditoria com uma checagem por prazo informado.
 *
 * Varias checagens com prazos diferentes na MESMA auditoria e o que torna
 * verificavel a escolha do menor: com duas datas, pegar a errada muda a frase.
 */
async function criarAuditoria(
  tenantId: string,
  leadId: string,
  prazos: readonly Date[],
): Promise<string> {
  const auditoria = await admin.digitalPresenceAudit.create({
    data: { tenantId, leadId, auditVersion: `aviso-${sufixo}`, providerName: 'mock' },
  });

  await admin.digitalPresenceCheck.createMany({
    data: prazos.map((retentionUntil, indice) => ({
      tenantId,
      auditId: auditoria.id,
      check: indice === 0 ? ('DNS' as const) : ('HTTPS' as const),
      outcome: 'OK' as const,
      retentionUntil,
    })),
  });

  return auditoria.id;
}

async function avisosDe(auditId: string) {
  return admin.notification.findMany({ where: { dedupeKey: chaveDeAviso(auditId) } });
}

beforeAll(async () => {
  tenantA = await criarTenant('a');
  tenantB = await criarTenant('b');

  const leadA = await criarLead(tenantA, 'perto');
  const leadLonge = await criarLead(tenantA, 'longe');
  const leadB = await criarLead(tenantB, 'vizinho');

  // Duas datas na mesma auditoria: a de perto e a real, a de longe e a isca
  // para quem pegasse o maior.
  auditoriaPerto = await criarAuditoria(tenantA, leadA, [dataPerto, dataLonge]);
  auditoriaLonge = await criarAuditoria(tenantA, leadLonge, [dataLonge]);
  auditoriaDoVizinho = await criarAuditoria(tenantB, leadB, [dataPerto]);
}, TIMEOUT_HOOK_MS);

afterAll(async () => {
  // Alto de proposito, ao contrario das outras suites deste diretorio: limpeza
  // que falha em silencio deixa lixo que reprova outra suite, longe daqui.
  // Ver `apps/api/test/limpeza.ts`.
  for (const id of [tenantA, tenantB]) {
    if (!id) continue;
    await admin.tenant.delete({ where: { id } }).catch((erro: unknown) => {
      console.error(`[limpeza] FALHOU: tenant ${id}`, erro);
      throw erro;
    });
  }

  await Promise.all([admin.$disconnect(), sistema.$disconnect(), app.$disconnect()]);
}, TIMEOUT_HOOK_MS);

describe('aviso de expiracao', () => {
  it('a janela e de 15 dias — e o numero vem da decisao, nao daqui', () => {
    // Trava contra mudanca silenciosa: a D6 fixou 15 com motivo escrito, e
    // trocar o numero tem que ser um ato deliberado que reprova este teste.
    expect(AVISO_ANTECEDENCIA_DIAS).toBe(15);
  });

  it('avisa nos dois tenants, e so as auditorias na janela', async () => {
    const resultado = await avisarExpiracao(sistema, app, agora);

    /**
     * **Os contadores sao `>=`, e nao `===`, porque o job e global.**
     *
     * Ele varre o banco inteiro, e esta suite nao e dona do banco: exigir o
     * numero exato seria afirmar sobre linhas de outras suites. O que e exato
     * esta abaixo, por auditoria.
     *
     * O `>= 2` ainda falsifica o erro que importa: com o papel da aplicacao na
     * descoberta, este numero seria **zero**.
     */
    expect(resultado.avisados).toBeGreaterThanOrEqual(2);
    // Se a enumeracao fosse pelo papel da aplicacao, este seria zero — e seria
    // o unico lugar do relatorio que explicaria por que nada foi avisado.
    expect(resultado.tenantsVarridos).toBeGreaterThanOrEqual(2);

    expect(await avisosDe(auditoriaPerto)).toHaveLength(1);
    expect(await avisosDe(auditoriaDoVizinho)).toHaveLength(1);
    expect(await avisosDe(auditoriaLonge)).toHaveLength(0);
  });

  it('a data do aviso e o MENOR prazo das checagens', async () => {
    const [aviso] = await avisosDe(auditoriaPerto);

    expect(aviso?.body).toContain(comoOAvisoEscreve(dataPerto));
    // A isca. Se alguem trocar `_min` por `_max`, esta linha e a que reprova.
    expect(aviso?.body).not.toContain(comoOAvisoEscreve(dataLonge));
  });

  it('o aviso leva ao lead, e carrega a auditoria', async () => {
    const [aviso] = await avisosDe(auditoriaPerto);
    const payload = aviso?.payload as { leadId?: string; auditId?: string };

    // `leadId` e o que faz o `toView` da API montar `/leads/:id` sem nenhuma
    // linha nova la. Aviso que nao leva a lugar nenhum e ruido.
    expect(payload.leadId).toBeTruthy();
    expect(payload.auditId).toBe(auditoriaPerto);
  });

  it('rodar de novo nao avisa de novo — e nao falha', async () => {
    /**
     * **O teste que sustenta a propriedade central da peca.**
     *
     * Se rodar duas vezes duplicasse o aviso, perder uma execucao passaria a
     * ser preferivel a repeti-la, e o job viraria infraestrutura critica. Quem
     * garante o contrario nao e o codigo do job: e o indice unico
     * `(tenantId, dedupeKey)`. Aqui se prova que a garantia esta ligada.
     */
    const resultado = await avisarExpiracao(sistema, app, agora);

    expect(resultado.jaAvisados).toBeGreaterThanOrEqual(2);

    // Estas duas sao a afirmacao de verdade, e sao exatas: continua havendo um
    // aviso por auditoria, nao dois.
    expect(await avisosDe(auditoriaPerto)).toHaveLength(1);
    expect(await avisosDe(auditoriaDoVizinho)).toHaveLength(1);
  });

  it('prazo ja vencido continua entrando na janela', async () => {
    /**
     * Nao ha limite inferior, e este teste e o que impede alguem de "consertar"
     * isso mais tarde.
     *
     * Uma checagem que passasse do prazo sem aviso nunca mais seria avisada — e
     * o expurgo da peca 4, que se recusa a apagar o que nao foi avisado,
     * adiaria aquela linha para sempre. Seria o crescimento sem limite que a D6
     * existe para impedir.
     */
    const leadVencido = await criarLead(tenantA, 'vencido');
    const auditoriaVencida = await criarAuditoria(tenantA, leadVencido, [
      new Date(agora.getTime() - 3 * DIA_MS),
    ]);

    const resultado = await avisarExpiracao(sistema, app, agora);

    expect(resultado.avisados).toBeGreaterThanOrEqual(1);
    expect(await avisosDe(auditoriaVencida)).toHaveLength(1);
  });
});
