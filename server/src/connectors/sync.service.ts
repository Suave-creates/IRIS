import type { ConnectorProvider } from '@iris/shared';
import { execute } from '../db/pool.js';
import { id } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { Errors } from '../lib/errors.js';
import { googleClient } from './google/client.js';
import type { SyncResult } from './google/sync.js';
import { CONNECTORS, GOOGLE_PROVIDER_LIST } from './registry.js';

export interface ProviderSyncOutcome {
  provider: ConnectorProvider;
  ok: boolean;
  imported: number;
  detail: string;
  error?: string;
}

/** Syncs one connector, recording a sync_run and updating connector status. Idempotent. */
export async function syncProvider(
  tenantId: string,
  userId: string,
  provider: ConnectorProvider,
): Promise<ProviderSyncOutcome> {
  const def = CONNECTORS[provider];
  if (!def.sync) throw Errors.validation(`${provider} sync is not available yet.`);

  const runId = id('srun');
  await execute(
    `INSERT INTO sync_runs (id, tenant_id, provider, status) VALUES (:id, :t, :p, 'running')`,
    { id: runId, t: tenantId, p: provider },
  );

  try {
    const result: SyncResult = await def.sync({ tenantId, userId });
    await execute(
      `UPDATE sync_runs SET status='success', stats=:stats, finished_at=NOW() WHERE id=:id`,
      { id: runId, stats: JSON.stringify({ imported: result.imported, detail: result.detail }) },
    );
    await execute(
      `UPDATE connectors SET status='connected', last_synced_at=NOW(), note=NULL WHERE tenant_id=:t AND provider=:p`,
      { t: tenantId, p: provider },
    );
    return { provider, ok: true, imported: result.imported, detail: result.detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, provider, tenantId }, 'connector sync failed');
    await execute(`UPDATE sync_runs SET status='error', error=:e, finished_at=NOW() WHERE id=:id`, {
      id: runId, e: message.slice(0, 480),
    });
    await execute(`UPDATE connectors SET status='error', note=:n WHERE tenant_id=:t AND provider=:p`, {
      t: tenantId, p: provider, n: 'Last sync failed',
    });
    return { provider, ok: false, imported: 0, detail: '', error: message };
  }
}

/** The providers currently syncable for a tenant (Google grant present). */
export async function syncableProviders(tenantId: string): Promise<ConnectorProvider[]> {
  const googleConnected = await googleClient.isConnected(tenantId);
  return googleConnected ? GOOGLE_PROVIDER_LIST : [];
}

/** "Sync Everything": syncs all connected connectors, reporting progress. */
export async function syncAll(
  tenantId: string,
  userId: string,
  onProgress: (event: { provider: ConnectorProvider; phase: 'start' | 'done'; outcome?: ProviderSyncOutcome }) => void,
): Promise<ProviderSyncOutcome[]> {
  const providers = await syncableProviders(tenantId);
  const outcomes: ProviderSyncOutcome[] = [];
  for (const provider of providers) {
    onProgress({ provider, phase: 'start' });
    const outcome = await syncProvider(tenantId, userId, provider);
    outcomes.push(outcome);
    onProgress({ provider, phase: 'done', outcome });
  }
  return outcomes;
}
