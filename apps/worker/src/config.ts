import path from 'node:path';

import dotenv from 'dotenv';

// O .env vive na raiz do monorepo.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6381',
  databaseUrl: process.env.DATABASE_URL ?? '',
  scraperBaseUrl: process.env.SCRAPER_BASE_URL ?? 'http://localhost:8081',
  /**
   * O scraper impoe teto de 300 segundos por job. Buscas maiores precisam
   * ser fatiadas em varios jobs, nao enviadas como job unico.
   */
  scraperTimeoutSeconds: Number(process.env.SCRAPER_TIMEOUT_SECONDS ?? 300),
  maxConcurrentJobs: Number(process.env.SCRAPER_MAX_CONCURRENT_JOBS ?? 2),
  leadSourceProvider: process.env.LEAD_SOURCE_PROVIDER ?? 'mock',
} as const;

/**
 * Prefixo das filas.
 *
 * O BullMQ proíbe `:` no nome da fila porque usa esse caractere como separador
 * das chaves no Redis. O namespacing correto é este prefixo — as chaves ficam
 * como `propectai:scrape:*`.
 *
 * Precisa bater exatamente com o que a API publica em
 * apps/api/src/prospecting/prospecting.service.ts.
 */
export const QUEUE_PREFIX = 'propectai';

export const QUEUE_NAMES = {
  scrape: 'scrape',
  enrich: 'enrich',
  score: 'score',
  notify: 'notify',
} as const;
