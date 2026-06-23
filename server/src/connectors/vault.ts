import type { RowDataPacket } from 'mysql2/promise';
import type { ConnectorProvider } from '@iris/shared';
import { execute, query } from '../db/pool.js';
import { id } from '../lib/ids.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string | null;
  /** Epoch ms when the access token expires (0 if unknown). */
  expiresAt: number;
}

interface TokenRow extends RowDataPacket {
  access_token: string;
  refresh_token: string | null;
  scopes: string | null;
  expires_at: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function toDateTime(ms: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Encrypted OAuth-token store. Plaintext never touches the database. */
export const vault = {
  async save(tenantId: string, provider: ConnectorProvider, t: StoredTokens): Promise<void> {
    await execute(
      `INSERT INTO connector_tokens (id, tenant_id, provider, access_token, refresh_token, scopes, expires_at)
       VALUES (:id, :t, :p, :at, :rt, :sc, :exp)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
         scopes = VALUES(scopes),
         expires_at = VALUES(expires_at)`,
      {
        id: id('ctok'),
        t: tenantId,
        p: provider,
        at: encryptSecret(t.accessToken),
        rt: t.refreshToken ? encryptSecret(t.refreshToken) : null,
        sc: t.scopes,
        exp: toDateTime(t.expiresAt),
      },
    );
  },

  async get(tenantId: string, provider: ConnectorProvider): Promise<StoredTokens | null> {
    const rows = await query<TokenRow[]>(
      'SELECT access_token, refresh_token, scopes, expires_at FROM connector_tokens WHERE tenant_id = :t AND provider = :p',
      { t: tenantId, p: provider },
    );
    const r = rows[0];
    if (!r) return null;
    return {
      accessToken: decryptSecret(r.access_token),
      refreshToken: r.refresh_token ? decryptSecret(r.refresh_token) : null,
      scopes: r.scopes,
      expiresAt: r.expires_at ? Date.parse(`${r.expires_at}Z`) || 0 : 0,
    };
  },

  /** Updates just the access token after a refresh (keeps the existing refresh token). */
  async updateAccess(tenantId: string, provider: ConnectorProvider, accessToken: string, expiresAt: number): Promise<void> {
    await execute(
      'UPDATE connector_tokens SET access_token = :at, expires_at = :exp WHERE tenant_id = :t AND provider = :p',
      { at: encryptSecret(accessToken), exp: toDateTime(expiresAt), t: tenantId, p: provider },
    );
  },

  async remove(tenantId: string, provider: ConnectorProvider): Promise<void> {
    await execute('DELETE FROM connector_tokens WHERE tenant_id = :t AND provider = :p', { t: tenantId, p: provider });
  },

  /** All tenant+provider pairs with tokens (for the refresh worker). */
  async listExpiring(withinMs: number): Promise<{ tenantId: string; provider: ConnectorProvider }[]> {
    const cutoff = toDateTime(Date.now() + withinMs);
    const rows = await query<(RowDataPacket & { tenant_id: string; provider: ConnectorProvider })[]>(
      `SELECT tenant_id, provider FROM connector_tokens
       WHERE refresh_token IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= :cutoff`,
      { cutoff },
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, provider: r.provider }));
  },
};
