export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks: {
    database: 'ok' | 'down';
    redis: 'ok' | 'down';
    /**
     * Motor de coleta. Diferente dos outros dois, nao e essencial: a aplicacao
     * inteira funciona sem ele, so nao inicia busca nova. Por isso derruba o
     * status para 'degraded', nunca para 'down'.
     */
    scraper: 'ok' | 'down';
  };
}

export interface VersionResponse {
  name: string;
  version: string;
  environment: string;
  commit: string | null;
  builtAt: string | null;
}

export const APP_VERSION = '0.1.1';
