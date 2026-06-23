import { buildApp } from './app.js';
import { env, hasAnthropic, hasGoogleOAuth, isProd } from './config/env.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { startWorkers, stopWorkers } from './connectors/workers.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    try {
      stopWorkers();
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
  startWorkers();

  // Security-relevant: with SSO enabled and no domain allow-list, any verified
  // Google account self-provisions a tenant. Warn in every environment.
  if (hasGoogleOAuth && env.AUTH_ALLOWED_DOMAINS.length === 0) {
    logger.warn('AUTH_ALLOWED_DOMAINS is empty — any verified Google account can sign in and create a tenant. Set it to restrict SSO to your domain(s).');
  }
  if (!isProd) {
    if (!hasAnthropic) logger.warn('ANTHROPIC_API_KEY not set — AI features will be unavailable until configured.');
    if (!hasGoogleOAuth) logger.warn('Google OAuth not configured — SSO sign-in and Google connectors are disabled until GOOGLE_CLIENT_ID/SECRET are set.');
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
