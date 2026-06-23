import { buildApp } from './app.js';
import { env, hasAnthropic, hasGoogleOAuth, isProd } from './config/env.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  if (!isProd) {
    if (!hasAnthropic) logger.warn('ANTHROPIC_API_KEY not set — AI features will be unavailable until configured.');
    if (!hasGoogleOAuth) logger.warn('Google OAuth not configured — SSO sign-in and Google connectors are disabled until GOOGLE_CLIENT_ID/SECRET are set.');
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
