import type { SiteAuditProvider } from '@propectai/types';

import { config } from '../../config';
import { logger } from '../../logger';
import { MockSiteAuditProvider } from './mock.provider';
import { NativeSiteAuditProvider } from './native.provider';

/**
 * Fabrica, no mesmo formato do `createLeadSourceProvider`: escolhe por variavel
 * de ambiente, loga a escolha, e cai no mock quando nada foi dito.
 *
 * O fallback e logado e nao silencioso de proposito. Auditoria que devolve dado
 * de mock parece auditoria de verdade na tela — a unica diferenca visivel esta
 * no log, entao o log precisa existir.
 */
export function createSiteAuditProvider(): SiteAuditProvider {
  if (config.siteAuditProvider === 'native') {
    logger.info('Provider de auditoria: nativo (DNS e socket reais)');
    return new NativeSiteAuditProvider();
  }

  logger.info('Provider de auditoria: mock (defina SITE_AUDIT_PROVIDER=native para o real)');
  return new MockSiteAuditProvider();
}

export { MockSiteAuditProvider, NativeSiteAuditProvider };
