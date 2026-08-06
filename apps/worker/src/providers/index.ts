import type { LeadSourceProvider } from '@propectai/types';

import { config } from '../config';
import { logger } from '../logger';
import { GoogleMapsScraperProvider } from './google-maps.provider';
import { MockLeadSourceProvider } from './mock.provider';

export function createLeadSourceProvider(): LeadSourceProvider {
  if (config.leadSourceProvider === 'google-maps') {
    logger.info({ url: config.scraperBaseUrl }, 'Provider: gosom/google-maps-scraper');
    return new GoogleMapsScraperProvider();
  }

  logger.info('Provider: mock (defina LEAD_SOURCE_PROVIDER=google-maps para o real)');
  return new MockLeadSourceProvider();
}

export { GoogleMapsScraperProvider, MockLeadSourceProvider };
