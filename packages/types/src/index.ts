/**
 * @propectai/types
 *
 * Contratos compartilhados entre api, web e worker.
 * Este pacote nao importa Prisma nem NestJS: e o vocabulario comum,
 * sem acoplamento a nenhuma camada.
 */

export * from './common';
export * from './auth';
export * from './account-api';
export * from './dashboard';
export * from './lead';
export * from './lead-api';
export * from './lead-source';
export * from './normalize';
export * from './notification-api';
export * from './outreach-api';
export * from './pipeline-api';
export * from './pricing-api';
export * from './proposal-api';
export * from './prospecting-api';
export * from './score';
export * from './scoring-engine';
export * from './system';
export * from './team-api';
