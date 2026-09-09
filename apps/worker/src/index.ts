import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { QUEUE_NAMES, QUEUE_PREFIX, config } from './config';
import { criarPrismaApp } from './db/prisma-app';
import { criarPrismaSistema } from './db/prisma-sistema';
import { logger } from './logger';
import { avisarExpiracao } from './pipeline/avisar-expiracao';
import { expurgarMedicoes } from './pipeline/expurgar-medicoes';
import {
  processAuditJob,
  type AuditJobPayload,
} from './pipeline/process-audit-job';
import {
  processScrapeJob,
  type ScrapeJobPayload,
} from './pipeline/process-scrape-job';
import { createLeadSourceProvider } from './providers';
import { createSiteAuditProvider } from './providers/site-audit';

/**
 * Worker do PropectAI.
 *
 * Consome a fila de coleta e executa o ciclo completo:
 * fonte -> higienização -> normalização -> deduplicação -> presença digital
 * -> score -> liquidação de cota -> notificação -> auditoria.
 */

// Passo 4: papel sujeito a politica. Ver `db/prisma-app.ts` para o motivo de
// isto ser variavel propria e nao troca do `DATABASE_URL`.
const prisma = criarPrismaApp();

/**
 * So a descoberta do aviso de expiracao usa este. Ver `db/prisma-sistema.ts`
 * para por que ela nao pode usar o de cima.
 */
const prismaSistema = criarPrismaSistema();

const provider = createLeadSourceProvider();
const auditProvider = createSiteAuditProvider();

/**
 * Tentativas da auditoria.
 *
 * Declarado aqui e nao so nas opcoes do job porque o pipeline precisa saber se
 * esta na ultima: e o que decide entre levantar o erro — deixando o BullMQ
 * repetir — e gravar `FAILED` devolvendo a cota.
 */
const AUDIT_TENTATIVAS = 3;

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

const scrapeWorker = new Worker<ScrapeJobPayload>(
  QUEUE_NAMES.scrape,
  async (job: Job<ScrapeJobPayload>) => {
    logger.info(
      {
        jobId: job.id,
        tenantId: job.data.tenantId,
        keyword: job.data.keyword,
        attempt: job.attemptsMade + 1,
      },
      'Iniciando coleta',
    );

    const result = await processScrapeJob(prisma, provider, job.data);

    logger.info(
      { jobId: job.id, ...result },
      'Coleta concluída',
    );

    return result;
  },
  {
    connection,
    prefix: QUEUE_PREFIX,
    // Concorrência baixa de propósito: coleta em volume é sujeita a bloqueio
    // pela fonte, e paralelismo agressivo acelera o bloqueio, não o resultado.
    concurrency: config.maxConcurrentJobs,
  },
);

const auditWorker = new Worker<AuditJobPayload>(
  QUEUE_NAMES.audit,
  async (job: Job<AuditJobPayload>) => {
    // **O id do job e a credencial da mensagem.** Sem ele o pipeline nao tem
    // como separar retry legitimo de payload forjado — ver `audit-decisoes.ts`.
    const queueJobId = job.id;
    if (queueJobId === undefined) {
      throw new Error('Job de auditoria sem id: impossivel distinguir retry de forjado');
    }

    const result = await processAuditJob(prisma, auditProvider, job.data, {
      queueJobId,
      ultimaTentativa: job.attemptsMade + 1 >= AUDIT_TENTATIVAS,
    });

    logger.info({ jobId: job.id, ...result }, 'Auditoria concluída');
    return result;
  },
  {
    connection,
    prefix: QUEUE_PREFIX,
    // Mais folgada que a coleta: a auditoria fala com o site do próprio lead,
    // um alvo por vez, e não com uma fonte que bloqueia por volume.
    concurrency: 4,
  },
);

// =============================================================================
// Aviso de expiracao das medicoes — D6, peca 3.
// =============================================================================

/**
 * **O primeiro trabalho deste processo que ninguem pede.**
 *
 * Ate aqui o worker so consumia: todo job chegava por uma acao de alguem na
 * API. Este chega por relogio, e por isso o worker passa a ser tambem
 * **produtor** — a `Queue` abaixo e a primeira do arquivo.
 *
 * A alternativa era um cron fora do repositorio. Foi descartada pelo que este
 * projeto ja pagou uma vez: um gatilho que mora fora do codigo e um gatilho que
 * ninguem ve faltar. O CI nao existiu por semanas enquanto oito notas
 * descreviam um ajuste nele.
 */
const AVISO_AGENDADOR = 'aviso-retencao-diario';

/**
 * Nove da manha, no fuso de quem le.
 *
 * A hora importa pouco e o fuso importa: um aviso disparado a meia-noite UTC
 * chega no fim da tarde anterior em Sao Paulo, e "voce tem 15 dias" que aparece
 * no dia 14 e um aviso que ja comecou errado.
 */
const AVISO_CRON = '0 9 * * *';
const AVISO_TZ = 'America/Sao_Paulo';

const notifyQueue = new Queue(QUEUE_NAMES.notify, { connection, prefix: QUEUE_PREFIX });

const notifyWorker = new Worker(
  QUEUE_NAMES.notify,
  async (job: Job) => {
    /**
     * **Avisa, depois apaga — e a ordem e o que torna a promessa executavel.**
     *
     * As duas metades da D6 moram no mesmo job de proposito. Se o aviso subir
     * erro, o `await` abaixo nunca acontece e **nada e apagado naquele dia** —
     * a direcao segura da falha, sem nenhuma trava extra para isso.
     *
     * Junta-las tambem faz a sequencia ser codigo em vez de convencao: nao ha
     * como alguem agendar o expurgo sozinho por engano.
     */
    const aviso = await avisarExpiracao(prismaSistema, prisma);
    const expurgo = await expurgarMedicoes(prismaSistema, prisma);

    const resultado = { aviso, expurgo };
    // Aninhado, e nao espalhado: os dois relatorios tem `tenantsVarridos`, e
    // espalhar faria um sobrescrever o outro em silencio.
    logger.info({ jobId: job.id, aviso, expurgo }, 'Retencao processada');
    return resultado;
  },
  {
    connection,
    prefix: QUEUE_PREFIX,
    // Uma de cada vez: e uma varredura, e duas simultaneas so produziriam
    // colisao de chave unica uma contra a outra.
    concurrency: 1,
  },
);

notifyWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, attempt: job?.attemptsMade, error: error.message },
    'Aviso de expiracao falhou',
  );
});

/**
 * Registrar o agendador e idempotente — `upsert`, e nao `add`. Reiniciar o
 * worker nao multiplica execucoes.
 *
 * **Falha aqui nao derruba o processo, e a escolha e desconfortavel.** Um
 * worker sem agendador para de avisar em silencio; um worker que nao sobe para
 * de coletar e de auditar, que e o que o cliente paga. Entao registra-se a
 * falha em voz alta e segue-se — e fica dito aqui que, se este aviso aparecer,
 * a peca 4 nao pode apagar nada ate ele parar de aparecer.
 */
void notifyQueue
  .upsertJobScheduler(AVISO_AGENDADOR, { pattern: AVISO_CRON, tz: AVISO_TZ })
  .then(() => {
    logger.info({ pattern: AVISO_CRON, tz: AVISO_TZ }, 'Aviso de expiracao agendado');
  })
  .catch((error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'NAO foi possivel agendar o aviso de expiracao — ninguem sera avisado',
    );
  });

auditWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, attempt: job?.attemptsMade, error: error.message },
    'Job de auditoria falhou',
  );
});

scrapeWorker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, attempt: job?.attemptsMade, error: error.message },
    'Job falhou',
  );
});

scrapeWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Job concluído');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Encerrando worker');
  await Promise.all([scrapeWorker.close(), auditWorker.close(), notifyWorker.close()]);
  // A fila depois dos workers: fecha-la antes deixaria quem ainda esta
  // encerrando falando com uma conexao ja recolhida.
  await notifyQueue.close();
  await connection.quit();
  await Promise.all([prisma.$disconnect(), prismaSistema.$disconnect()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info(
  {
    redis: config.redisUrl,
    provider: provider.name,
    auditProvider: auditProvider.name,
    concurrency: config.maxConcurrentJobs,
    scraper: config.scraperBaseUrl,
  },
  'PropectAI worker v0.1.1 iniciado',
);
