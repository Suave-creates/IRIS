import { pino, type LoggerOptions } from 'pino';
import { env, isDev } from '../config/env.js';

/**
 * Shared pino configuration. In development we pretty-print; in production we
 * emit newline-delimited JSON suitable for aggregation / future analytics.
 * Fastify is configured from these same options so request and non-request
 * logs are formatted identically.
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'iris-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      'DB_PASSWORD',
      'ANTHROPIC_API_KEY',
    ],
    censor: '[redacted]',
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } }
    : undefined,
};

/** Root logger for non-request contexts (startup, workers, db). */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
