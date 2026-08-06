import { PrismaClient } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { QUEUE_NAMES, QUEUE_PREFIX, config } from './config';
import { logger } from './logger';
import {
  processScrapeJob,
  type ScrapeJobPayload,
} from './pipeline/process-scrape-job';
import { createLeadSourceProvider } from './providers';

/**
 * Worker do PropectAI.
 *
 * Consome a fila de coleta e executa o ciclo completo:
 * fonte -> higienização -> normalização -> deduplicação -> presença digital
 * -> score -> liquidação de cota -> notificação -> auditoria.
 */

const prisma = new PrismaClient();
const provider = createLeadSourceProvider();

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
  await scrapeWorker.close();
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
    concurrency: config.maxConcurrentJobs,
    scraper: config.scraperBaseUrl,
  },
  'PropectAI worker v0.1.1 iniciado',
);
