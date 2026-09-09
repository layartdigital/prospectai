import { type PrismaClient } from '@prisma/client';

import { comTenant } from '../db/com-tenant';
import { logger } from '../logger';
import { chaveDeAviso } from './audit-decisoes';

/**
 * Expurgo das medicoes vencidas. D6, peca 4.
 *
 * ---
 *
 * **A peca que da sentido as outras tres.**
 *
 * Ate aqui o `retentionUntil` era decorativo: gravado em toda checagem, lido
 * por ninguem. A propria decisao registra o diagnostico — *"os 180 dias sao uma
 * promessa que ninguem cumpre, pior que nao ter prazo, porque o campo da a
 * impressao de que ha controle"*.
 *
 * ---
 *
 * **A acao destrutiva exige prova, e nao confianca.**
 *
 * A condicao para apagar tem duas partes, e as duas sao consultas ao banco:
 * o prazo passou, **e** existe `Notification` com o `dedupeKey` daquela
 * auditoria. Sem o aviso registrado, a linha nao e apagada — e **adiada**, e
 * contada no relatorio.
 *
 * A frase da decisao e literal: *"o expurgo nao apaga checagem cuja notificacao
 * nao foi registrada — ele adia. Sem essa trava, um defeito no notificador vira
 * perda silenciosa de dado: o cliente descobre que o relatorio sumiu no dia em
 * que foi procura-lo, e nos descobrimos junto com ele."*
 *
 * E a mesma forma do `decidirExecucao`: a acao irreversivel pede evidencia de
 * que a condicao anterior aconteceu, nao a suposicao de que aconteceu.
 *
 * ---
 *
 * **Uma condicao so, e nao duas.**
 *
 * Chegou a ser proposta uma terceira exigencia — que o aviso tivesse pelo menos
 * quinze dias de idade —, para cobrir o caso em que alguem e avisado hoje e
 * perde o dado amanha. Foi **descartada de proposito**: a decisao pede registro,
 * e nao maturidade, e legislar alem do que esta escrito e como se erra em ambas
 * as direcoes.
 *
 * O caso que ela cobria e estreito, porque aviso e expurgo sao o mesmo job: nao
 * existe "avisou tarde" sem "esteve parado por mais de quinze dias". Nesse
 * cenario o cliente ja recebeu os 180 dias prometidos, e o contador de adiadas
 * abaixo denuncia o buraco antes que ele se feche. **A consequencia fica
 * anotada aqui em vez de virar regra que ninguem pediu:** num religamento apos
 * parada longa, e possivel ser avisado num dia e ver a medicao sumir no
 * seguinte.
 *
 * ---
 *
 * **O que NAO e apagado: a auditoria.**
 *
 * A D6 pergunta literalmente "por quanto tempo as linhas de
 * `DigitalPresenceCheck` ficam?". A auditoria e o registro de que a medicao
 * aconteceu — quem pediu, quando, com que resultado — e sai de cena junto com o
 * lead, nao com o prazo. A API ja sobrevive a isso: ha teste afirmando que
 * auditoria sem checagem devolve prazo **nulo, e nao uma data inventada**.
 *
 * ---
 *
 * **Uma transacao por auditoria, com o registro dentro dela.**
 *
 * Nao ha `deleteMany` global: cada auditoria e apagada no seu proprio bloco,
 * junto com o `auditLog` que diz quantas linhas sairam. Duas razoes, e a
 * segunda e a que importa: uma varredura grande vira muitas transacoes curtas
 * em vez de uma longa segurando trava; e **dado de cliente nao e apagado sem
 * registro de que foi apagado** — se o `auditLog` falhar, a exclusao volta
 * atras junto.
 */

export interface ResultadoExpurgo {
  tenantsVarridos: number;
  auditoriasComVencidas: number;
  checagensApagadas: number;
  /** Vencidas que ficaram porque a auditoria nao tem aviso registrado. */
  adiadas: number;
}

export async function expurgarMedicoes(
  sistema: PrismaClient,
  app: PrismaClient,
  agora: Date = new Date(),
): Promise<ResultadoExpurgo> {
  const tenants = await sistema.tenant.findMany({ select: { id: true } });

  let auditoriasComVencidas = 0;
  let checagensApagadas = 0;
  let adiadas = 0;

  for (const { id: tenantId } of tenants) {
    const vencidas = await procurarVencidas(app, tenantId, agora);
    auditoriasComVencidas += vencidas.length;

    for (const auditoria of vencidas) {
      if (!auditoria.temAviso) {
        adiadas += auditoria.quantas;
        continue;
      }

      checagensApagadas += await apagarUma(app, tenantId, auditoria.auditId, agora);
    }
  }

  if (adiadas > 0) {
    /**
     * **Nao e detalhe de log, e o sinal de que o notificador esta atrasado.**
     *
     * Adiar e o comportamento correto, e adiar repetidamente e sintoma. Se este
     * numero nao voltar a zero em alguns dias, algo impede o aviso de ser
     * registrado — e a tabela cresce enquanto isso.
     */
    logger.warn(
      { adiadas },
      'Medicoes vencidas nao apagadas por falta de aviso registrado',
    );
  }

  return {
    tenantsVarridos: tenants.length,
    auditoriasComVencidas,
    checagensApagadas,
    adiadas,
  };
}

interface AuditoriaVencida {
  readonly auditId: string;
  readonly quantas: number;
  readonly temAviso: boolean;
}

/**
 * As auditorias de um tenant com checagem vencida, ja com a resposta sobre o
 * aviso.
 *
 * As duas consultas ficam na mesma transacao pelo mesmo motivo do job de aviso:
 * a segunda so faz sentido sobre os ids que a primeira devolveu.
 */
async function procurarVencidas(
  app: PrismaClient,
  tenantId: string,
  agora: Date,
): Promise<AuditoriaVencida[]> {
  return comTenant(app, tenantId, async (tx) => {
    const grupos = await tx.digitalPresenceCheck.groupBy({
      by: ['auditId'],
      where: { retentionUntil: { lt: agora } },
      _count: { _all: true },
    });

    if (grupos.length === 0) return [];

    const chaves = grupos.map((grupo) => chaveDeAviso(grupo.auditId));
    const avisos = await tx.notification.findMany({
      where: { dedupeKey: { in: chaves } },
      select: { dedupeKey: true },
    });
    const avisadas = new Set(avisos.map((aviso) => aviso.dedupeKey));

    return grupos.map((grupo) => ({
      auditId: grupo.auditId,
      quantas: grupo._count._all,
      temAviso: avisadas.has(chaveDeAviso(grupo.auditId)),
    }));
  });
}

/** Apaga as checagens vencidas de uma auditoria. Devolve quantas sairam. */
async function apagarUma(
  app: PrismaClient,
  tenantId: string,
  auditId: string,
  agora: Date,
): Promise<number> {
  return comTenant(app, tenantId, async (tx) => {
    /**
     * O `retentionUntil` volta no `where`, e nao e redundancia.
     *
     * A auditoria entrou na lista por ter **alguma** checagem vencida. Apagar
     * por `auditId` sozinho levaria junto as que ainda estao no prazo — e o
     * prazo e por checagem, nao por auditoria. Na pratica as datas de uma mesma
     * auditoria sao iguais a menos de milissegundos, porque nascem na mesma
     * transacao; **mas isso e propriedade de como sao escritas hoje, e nao
     * garantia do modelo.**
     */
    const { count } = await tx.digitalPresenceCheck.deleteMany({
      where: { auditId, retentionUntil: { lt: agora } },
    });

    if (count === 0) return 0;

    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'audit.checks.purged',
        entityType: 'DigitalPresenceAudit',
        entityId: auditId,
        // `before` e nao `after`: o que se registra e o que havia. Depois nao ha
        // nada — e essa e justamente a informacao que se perderia sem isto.
        before: { checagens: count },
      },
    });

    return count;
  });
}
