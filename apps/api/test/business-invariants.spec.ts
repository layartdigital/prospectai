import path from 'node:path';

import dotenv from 'dotenv';
import { criarPrismaAdmin } from './prisma-admin';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Invariantes comerciais — regras 5.3 e 5.4 do escopo da v0.1.1.
 *
 * São verificações de ESTADO, não de comportamento: varrem o banco inteiro e
 * afirmam que nenhuma linha viola as regras, independentemente de quem a
 * gravou — worker, seed, recálculo manual ou migração futura.
 *
 * A distinção importa e está declarada de propósito: um teste de invariante
 * passa trivialmente num banco vazio. Ele é rede de segurança permanente, não
 * prova de que o pipeline funciona. A prova de comportamento é o teste do
 * worker, que roda a busca duas vezes e força a falha.
 *
 * Valor real: pega o defeito em qualquer origem. Se alguém acrescentar um
 * caminho novo que grava lead sem score, este teste acusa sem precisar
 * conhecer o caminho novo.
 *
 * Precisa de `pnpm docker:up`, `pnpm db:migrate` e `pnpm db:seed` antes.
 */

/**
 * **Cliente de fixtures, e nao o da aplicacao.**
 *
 * Este arquivo monta cenario e confere invariante — nao exercita o caminho da
 * aplicacao em lugar nenhum. As duas coisas exigem enxergar todos os tenants,
 * entao o papel certo e o que ignora a politica.
 *
 * Vinha usando `new PrismaClient()`, que conecta pelo `DATABASE_URL` — o dono
 * do banco, que **hoje** e superusuario e por isso ignora RLS. Funcionava por
 * consequencia da configuracao, nao por escolha: no dia em que o `DATABASE_URL`
 * apontar para um papel comum, estas consultas passariam a devolver vazio sem
 * erro nenhum.
 *
 * `criarPrismaAdmin()` usa o `DATABASE_URL_MIGRATOR`, cujo `BYPASSRLS` e
 * atributo do papel e nao efeito colateral de ser dono. O nome `admin` segue a
 * convencao dos outros specs: `admin` ignora a politica, `admin` esta sujeito
 * a ela.
 */
const admin = criarPrismaAdmin();
const DB_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  await admin.$connect();
}, DB_TIMEOUT_MS);

afterAll(async () => {
  await admin.$disconnect();
}, DB_TIMEOUT_MS);

describe('regra 5.4 — nenhum lead visível fica sem score explicado', () => {
  it('todo lead com score tem pelo menos um motivo', async () => {
    // O número sozinho não serve: o produto vende explicabilidade. Score sem
    // motivo é score que ninguém pode contestar, e a ficha do lead renderiza
    // "nenhum ponto identificado" nas duas colunas.
    const scores = await admin.leadScore.findMany({
      select: { leadId: true, value: true, _count: { select: { reasons: true } } },
    });

    const semMotivo = scores.filter((score) => score._count.reasons === 0);

    expect(
      semMotivo.map((score) => ({ leadId: score.leadId, value: score.value })),
    ).toEqual([]);
  });

  it('nenhum lead ativo ficou sem registro de score', async () => {
    // Lead sem LeadScore aparece na lista com score nulo. O ciclo de estados
    // do job (RUNNING → NORMALIZING → SCORING → COMPLETED) existe justamente
    // para que nada chegue à interface antes de SCORING terminar.
    const orfaos = await admin.lead.findMany({
      where: { deletedAt: null, score: { is: null } },
      select: { id: true, name: true, tenantId: true },
      take: 20,
    });

    expect(orfaos).toEqual([]);
  });

  it('score fora da faixa 0–100 é defeito, não resultado', async () => {
    const foraDaFaixa = await admin.leadScore.count({
      where: { OR: [{ value: { lt: 0 } }, { value: { gt: 100 } }] },
    });

    expect(foraDaFaixa).toBe(0);
  });
});

describe('regra 5.3 — cota reflete lead novo, não linha retornada', () => {
  it('nenhum período tem reserva ou liquidação negativa', async () => {
    // Devolver reserva de job falho com subtração maior que a reserva original
    // produz saldo negativo — o cliente ganharia crédito por falhar.
    const negativos = await admin.planUsage.findMany({
      where: {
        OR: [{ leadsReserved: { lt: 0 } }, { leadsSettled: { lt: 0 } }],
      },
      select: { tenantId: true, periodStart: true, leadsReserved: true, leadsSettled: true },
    });

    expect(negativos).toEqual([]);
  });

  it('não há reserva pendurada de job que já terminou', async () => {
    // Reserva é liberada no fim do job, em qualquer desfecho: COMPLETED
    // liquida com o número real de leads novos, FAILED devolve tudo. Sobrar
    // reserva sem job em andamento significa cota consumida por trabalho que
    // não existe mais — o cliente paga por nada.
    const emAndamento = await admin.scrapeJob.count({
      where: { status: { in: ['QUEUED', 'RUNNING', 'NORMALIZING', 'SCORING'] } },
    });

    if (emAndamento > 0) {
      // Não é falha: há job legítimo em voo. O invariante só vale com a fila
      // parada, e afirmar o contrário produziria teste intermitente.
      return;
    }

    const comReserva = await admin.planUsage.findMany({
      where: { leadsReserved: { gt: 0 } },
      select: { tenantId: true, periodStart: true, leadsReserved: true },
    });

    expect(comReserva).toEqual([]);
  });

  it('leads liquidados não excedem os leads que existem no tenant', async () => {
    // Duplicado atualiza e não cobra. Se a liquidação passar da contagem real
    // de leads do tenant, alguém está cobrando por linha retornada e não por
    // lead novo — exatamente a regra que 5.3 proíbe.
    const usos = await admin.planUsage.groupBy({
      by: ['tenantId'],
      _sum: { leadsSettled: true },
    });

    for (const uso of usos) {
      const settled = uso._sum.leadsSettled ?? 0;
      if (settled === 0) continue;

      const existentes = await admin.lead.count({ where: { tenantId: uso.tenantId } });

      expect(settled).toBeLessThanOrEqual(existentes);
    }
  });
});
