import { Prisma, type PrismaClient } from '@prisma/client';

import { comTenant } from '../db/com-tenant';
import { logger } from '../logger';
import { chaveDeAviso, limiteDoAviso } from './audit-decisoes';

/**
 * Aviso de expiracao das medicoes. D6, peca 3.
 *
 * ---
 *
 * **A primeira coisa que o worker faz sem ninguem pedir.**
 *
 * Todo job que existia ate aqui carrega o `tenantId` de quem o disparou. Este
 * roda por relogio, e por isso precisa comecar por algo que nenhum tenant pode
 * responder: *sobre quais workspaces eu devo perguntar?*
 *
 * ---
 *
 * **A primeira versao errou a rota, e o banco recusou — como fora desenhado
 * para recusar.**
 *
 * Ela pedia ao papel `propectai_sistema` um `groupBy` direto em
 * `digital_presence_checks`, para descobrir tudo numa consulta so. O Postgres
 * respondeu `42501 permission denied` — **e nao foi RLS, foi privilegio**: o
 * papel nunca recebeu `SELECT` naquela tabela.
 *
 * A migration `rls_papel_sistema_estreitar` explica por que, e a frase e
 * literal: *"o sintoma sera `permission denied` — alto e imediato —, que e o
 * mesmo principio de nao haver `ALTER DEFAULT PRIVILEGES` para este papel"*.
 * Tabela nova nascer invisivel para o papel do sistema **e a intencao**, para
 * que todo alargamento seja deliberado.
 *
 * Entao a resposta certa nao era conceder tres `GRANT` e seguir: era ouvir o
 * banco. O que este arquivo faz agora:
 *
 * - **`sistema` so enumera os tenants.** `SELECT ON tenants` ele ja tem desde
 *   que nasceu, para guard, billing e painel — saber quais workspaces existem e
 *   exatamente o que ele foi autorizado a saber.
 * - **Todo o resto passa por `comTenant` com o papel da aplicacao.** Ler as
 *   medicoes e escrever o aviso acontecem sob a politica, como qualquer outra
 *   leitura de dado de tenant no projeto.
 *
 * O preco e uma transacao por tenant por dia em vez de uma consulta unica. Para
 * um job diario isso e barato, e o que se compra e que a rotina nao abre
 * excecao ao invariante que o programa inteiro vem pagando para ter.
 *
 * ---
 *
 * **Perder uma execucao e inofensivo, e isso e a propriedade central.**
 *
 * A pergunta e de estado — "quais auditorias estao na janela e ainda nao tem
 * aviso?" — e nao de diferenca — "o que mudou desde ontem?". Com a segunda
 * forma, o agendador viraria infraestrutura critica e um dia de worker parado
 * viraria aviso perdido em silencio. Com esta, a proxima execucao cobre o
 * buraco sozinha.
 *
 * O outro lado da mesma moeda: **rodar duas vezes tambem e inofensivo.** Quem
 * garante isso nao e este arquivo, e o indice unico `(tenantId, dedupeKey)` da
 * tabela. Aqui so se trata a colisao.
 *
 * ---
 *
 * **Nao ha limite inferior na janela, e isso e deliberado — por dois motivos.**
 *
 * O primeiro e o que importa para a peca 4: uma checagem que passasse do prazo
 * sem ter sido avisada **nunca mais** seria avisada, e o expurgo — que se recusa
 * a apagar o que nao foi avisado — adiaria aquela linha para sempre. Seria
 * exatamente o crescimento sem limite que a D6 existe para impedir.
 *
 * O segundo e aritmetico: com um `gte: agora`, o `_min` abaixo passaria a ser o
 * menor prazo **entre os que sobraram na janela**, e nao o prazo real da
 * auditoria. A data no aviso ficaria errada, para mais, sem nada acusar.
 */

export interface ResultadoAviso {
  tenantsVarridos: number;
  /** Auditorias com pelo menos uma checagem dentro do limite. */
  auditoriasNaJanela: number;
  avisados: number;
  /** Colisao de `dedupeKey`: ja havia aviso. Esperado, e nao e erro. */
  jaAvisados: number;
}

interface AuditoriaNaJanela {
  readonly auditId: string;
  readonly prazo: Date;
  readonly leadId: string;
  readonly nomeDoLead: string;
}

export async function avisarExpiracao(
  sistema: PrismaClient,
  app: PrismaClient,
  agora: Date = new Date(),
): Promise<ResultadoAviso> {
  const limite = limiteDoAviso(agora);
  const tenants = await sistema.tenant.findMany({ select: { id: true } });

  let auditoriasNaJanela = 0;
  let avisados = 0;
  let jaAvisados = 0;

  for (const { id: tenantId } of tenants) {
    const naJanela = await procurarNaJanela(app, tenantId, limite);
    auditoriasNaJanela += naJanela.length;

    for (const auditoria of naJanela) {
      const criou = await avisarUma(app, tenantId, auditoria);
      if (criou) avisados += 1;
      else jaAvisados += 1;
    }
  }

  return { tenantsVarridos: tenants.length, auditoriasNaJanela, avisados, jaAvisados };
}

/**
 * As auditorias de um tenant com medicao perto do prazo.
 *
 * As duas consultas ficam na MESMA transacao: a segunda so faz sentido sobre os
 * ids que a primeira devolveu, e separa-las abriria uma janela em que uma
 * auditoria apagada no meio viraria uma entrada faltando no mapa.
 */
async function procurarNaJanela(
  app: PrismaClient,
  tenantId: string,
  limite: Date,
): Promise<AuditoriaNaJanela[]> {
  return comTenant(app, tenantId, async (tx) => {
    /**
     * O prazo da auditoria e o MENOR prazo das checagens dela.
     *
     * Mesma escolha do `prazoDaAuditoria` da API, e pelo mesmo motivo
     * registrado la: o maior seria uma promessa que o sistema nao cumpre. E e
     * o que permite ao aviso ter a auditoria como unidade — avisar por checagem
     * seria ruido, e daria a peca 4 uma pergunta sem resposta unica na hora de
     * apagar.
     */
    const grupos = await tx.digitalPresenceCheck.groupBy({
      by: ['auditId'],
      where: { retentionUntil: { lte: limite } },
      _min: { retentionUntil: true },
    });

    if (grupos.length === 0) return [];

    const auditorias = await tx.digitalPresenceAudit.findMany({
      where: { id: { in: grupos.map((grupo) => grupo.auditId) } },
      select: { id: true, leadId: true, lead: { select: { name: true } } },
    });
    const porId = new Map(auditorias.map((auditoria) => [auditoria.id, auditoria]));

    const encontradas: AuditoriaNaJanela[] = [];

    for (const grupo of grupos) {
      const auditoria = porId.get(grupo.auditId);
      const prazo = grupo._min.retentionUntil;

      /**
       * Nenhum dos dois deveria acontecer: a checagem tem chave estrangeira
       * para a auditoria, e o `where` acima ja garantiu que ha `retentionUntil`.
       * Se acontecer, e anomalia de dado — entao grita, e **nao** interrompe os
       * outros tenants, que nao tem culpa disto.
       */
      if (auditoria === undefined || prazo === null) {
        logger.error(
          { tenantId, auditId: grupo.auditId, achouAuditoria: auditoria !== undefined },
          'Checagem aponta para auditoria inexistente ou sem prazo',
        );
        continue;
      }

      encontradas.push({
        auditId: auditoria.id,
        prazo,
        leadId: auditoria.leadId,
        nomeDoLead: auditoria.lead.name,
      });
    }

    return encontradas;
  });
}

/** `true` se criou o aviso; `false` se ja havia um. Qualquer outro erro sobe. */
async function avisarUma(
  app: PrismaClient,
  tenantId: string,
  auditoria: AuditoriaNaJanela,
): Promise<boolean> {
  try {
    await comTenant(app, tenantId, (tx) =>
      tx.notification.create({
        data: {
          tenantId,
          type: 'RETENTION_EXPIRING',
          title: 'Medições perto do fim do prazo',
          /**
           * A frase diz a data, e nao "faltam N dias".
           *
           * A contagem envelheceria dentro da propria notificacao: quem
           * abrisse a caixa uma semana depois leria um numero falso. A data
           * continua verdadeira em qualquer dia — inclusive no caso raro em que
           * ela ja passou, que a janela sem limite inferior deixa entrar.
           */
          body:
            `As medições de ${auditoria.nomeDoLead} ficam disponíveis até ` +
            `${formatarData(auditoria.prazo)}. Exporte antes disso.`,
          /** `leadId` e o que faz o `toView` da API montar o link sozinho. */
          payload: { leadId: auditoria.leadId, auditId: auditoria.auditId },
          dedupeKey: chaveDeAviso(auditoria.auditId),
        },
      }),
    );
    return true;
  } catch (erro) {
    /**
     * O `catch` fica FORA do `comTenant`, e isso nao e estilo.
     *
     * O cabecalho do `com-tenant.ts` diz por que: depois de um erro o Postgres
     * aborta a transacao, e o `COMMIT` vira `ROLLBACK` sem lancar. Engolir a
     * colisao la dentro daria um sucesso que nao aconteceu.
     *
     * E por isso o aviso tem transacao propria, separada da leitura: uma
     * colisao esperada nao pode derrubar a varredura do tenant inteiro.
     */
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
      return false;
    }

    /**
     * Qualquer outro erro sobe e derruba a execucao inteira — de proposito.
     *
     * O BullMQ repete, e a repeticao **nao custa nada**: as auditorias ja
     * avisadas colidem na chave unica e caem no ramo de cima. Sem a chave,
     * subir o erro aqui seria arriscar avisar duas vezes; com ela, subir e
     * simplesmente a forma mais barata de nao perder o resto.
     */
    throw erro;
  }
}

/** Data em pt-BR, no fuso de quem le o aviso. Ver a nota no corpo da mensagem. */
function formatarData(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
