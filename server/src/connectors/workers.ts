import { env } from '../config/env.js';
import { execute } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { connectorOAuth } from './google/oauth.js';
import { vault } from './vault.js';

const REFRESH_INTERVAL_MS = 5 * 60_000;
const REFRESH_WINDOW_MS = 10 * 60_000;

let timer: NodeJS.Timeout | null = null;

/** Proactively refreshes connector access tokens that are about to expire. */
async function refreshExpiringTokens(): Promise<void> {
  const due = await vault.listExpiring(REFRESH_WINDOW_MS);
  for (const { tenantId, provider } of due) {
    try {
      const tokens = await vault.get(tenantId, provider);
      if (!tokens?.refreshToken) continue;
      const refreshed = await connectorOAuth.refresh(tokens.refreshToken);
      await vault.updateAccess(tenantId, provider, refreshed.accessToken, refreshed.expiresAt);
      logger.debug({ tenantId, provider }, 'refreshed connector token');
    } catch (err) {
      logger.warn({ err, tenantId, provider }, 'token refresh failed — marking expiring');
      await execute(`UPDATE connectors SET status='expiring', note='Reauthorization needed' WHERE tenant_id=:t AND provider=:p`, {
        t: tenantId, p: provider,
      }).catch(() => undefined);
    }
  }
}

async function tick(): Promise<void> {
  try {
    await refreshExpiringTokens();
  } catch (err) {
    logger.error({ err }, 'worker tick failed');
  }
}

/** Starts the in-process background workers (no-op when disabled). */
export function startWorkers(): void {
  if (!env.WORKERS_ENABLED) {
    logger.info('background workers disabled (WORKERS_ENABLED=false)');
    return;
  }
  // Stagger the first run so it doesn't fire during boot.
  timer = setInterval(() => void tick(), REFRESH_INTERVAL_MS);
  if (timer.unref) timer.unref();
  logger.info('background workers started (token refresh every 5m)');
}

export function stopWorkers(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
