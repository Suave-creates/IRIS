import type { ConnectorProvider } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { vault } from '../vault.js';
import { connectorOAuth } from './oauth.js';

const REFRESH_SKEW_MS = 60_000;

/** Google connectors share one OAuth grant, stored canonically under this provider. */
export const GOOGLE_GRANT: ConnectorProvider = 'gmail';
export const GOOGLE_PROVIDERS: ConnectorProvider[] = ['gmail', 'gcalendar', 'gdrive', 'gsheets'];

/** Valid access token for the tenant's Google grant, refreshing proactively. */
async function getAccessToken(tenantId: string): Promise<string> {
  const tokens = await vault.get(tenantId, GOOGLE_GRANT);
  if (!tokens) throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page.');

  if (tokens.expiresAt && tokens.expiresAt - Date.now() < REFRESH_SKEW_MS && tokens.refreshToken) {
    const refreshed = await connectorOAuth.refresh(tokens.refreshToken);
    await vault.updateAccess(tenantId, GOOGLE_GRANT, refreshed.accessToken, refreshed.expiresAt);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

async function rawRequest(tenantId: string, url: string, init?: RequestInit): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });

  let token = await getAccessToken(tenantId);
  let res = await doFetch(token);

  if (res.status === 401) {
    const tokens = await vault.get(tenantId, GOOGLE_GRANT);
    if (tokens?.refreshToken) {
      const refreshed = await connectorOAuth.refresh(tokens.refreshToken);
      await vault.updateAccess(tenantId, GOOGLE_GRANT, refreshed.accessToken, refreshed.expiresAt);
      token = refreshed.accessToken;
      res = await doFetch(token);
    }
  }
  return res;
}

async function request<T>(tenantId: string, url: string, init?: RequestInit): Promise<T> {
  const res = await rawRequest(tenantId, url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Errors.upstream(`Google API error (${res.status}): ${text.slice(0, 160)}`, 'Try reconnecting Google.');
  }
  return (await res.json()) as T;
}

export const googleClient = {
  isConnected: async (tenantId: string) => (await vault.get(tenantId, GOOGLE_GRANT)) !== null,
  get: <T>(tenantId: string, url: string) => request<T>(tenantId, url),
  /** Fetches a URL and returns the raw response body as text (e.g. Drive export). */
  getText: async (tenantId: string, url: string): Promise<string> => {
    const res = await rawRequest(tenantId, url);
    if (!res.ok) return '';
    return res.text();
  },
  post: <T>(tenantId: string, url: string, body: unknown, contentType = 'application/json') =>
    request<T>(tenantId, url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
};
