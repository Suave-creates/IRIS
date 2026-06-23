import type { ConnectorProvider } from '@iris/shared';
import { execute } from '../db/pool.js';
import { id } from '../lib/ids.js';
import { GOOGLE_GRANT, GOOGLE_PROVIDERS } from './google/client.js';
import type { TokenResponse } from './google/oauth.js';
import { CONNECTORS } from './registry.js';
import { vault } from './vault.js';

async function upsertConnector(tenantId: string, provider: ConnectorProvider, status: string): Promise<void> {
  const def = CONNECTORS[provider];
  await execute(
    `INSERT INTO connectors (id, tenant_id, provider, display_name, group_label, status, capabilities, last_synced_at)
     VALUES (:id, :t, :p, :dn, :g, :st, :cap, NULL)
     ON DUPLICATE KEY UPDATE status = VALUES(status), display_name = VALUES(display_name),
       group_label = VALUES(group_label), capabilities = VALUES(capabilities)`,
    { id: id('conn'), t: tenantId, p: provider, dn: def.displayName, g: def.group, st: status, cap: def.capabilities },
  );
}

export const connectService = {
  /** Stores the Google grant and marks all Google connectors connected. */
  async connectGoogle(tenantId: string, tokens: TokenResponse): Promise<void> {
    await vault.save(tenantId, GOOGLE_GRANT, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scope,
      expiresAt: tokens.expiresAt,
    });
    for (const p of GOOGLE_PROVIDERS) await upsertConnector(tenantId, p, 'connected');
  },

  /** Disconnects a connector. For Google, revokes the shared grant and disconnects all four. */
  async disconnect(tenantId: string, provider: ConnectorProvider): Promise<void> {
    if (CONNECTORS[provider].google) {
      await vault.remove(tenantId, GOOGLE_GRANT);
      for (const p of GOOGLE_PROVIDERS) {
        await execute('UPDATE connectors SET status = :s WHERE tenant_id = :t AND provider = :p', {
          s: 'disconnected', t: tenantId, p,
        });
      }
    } else {
      await execute('UPDATE connectors SET status = :s WHERE tenant_id = :t AND provider = :p', {
        s: 'disconnected', t: tenantId, p: provider,
      });
    }
  },
};
