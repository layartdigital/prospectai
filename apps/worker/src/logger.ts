import pino from 'pino';

import { config } from './config';

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  // Logs nunca carregam segredo nem dado pessoal completo.
  redact: {
    paths: ['*.password', '*.token', '*.authorization', '*.phone', '*.email'],
    censor: '[redigido]',
  },
  transport:
    config.nodeEnv === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
});
