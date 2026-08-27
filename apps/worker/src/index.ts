import { PrismaClient } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { QUEUE_NAMES, QUEUE_PREFIX, config } from './config';
import { logger } from './logger';
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

const prisma = new PrismaClient();
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
  await Promise.all([scrapeWorker.close(), auditWorker.close()]);
  await connection.quit();
  await prisma.$disconnect();
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
