import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Connector scopes (read across Google Workspace + Gmail send for action delivery). */
export const CONNECTOR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  // Write scope so IRIS can create events + invite guests on the user's calendar.
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  scope: string | null;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export const connectorOAuth = {
  /** Builds the consent URL for connector authorization (offline → refresh token). */
  createAuthRequest(): { url: string; state: string; verifier: string } {
    const { verifier, challenge } = pkce();
    const state = randomToken(24);
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_CONNECTOR_REDIRECT_URI,
      response_type: 'code',
      scope: CONNECTOR_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
    });
    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, verifier };
  },

  async exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CONNECTOR_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw Errors.upstream('Google rejected the connector authorization.');
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!j.access_token) throw Errors.upstream('Google did not return an access token.');
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
      scope: j.scope ?? null,
    };
  },

  /** Exchanges a refresh token for a fresh access token. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    const body = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw Errors.upstream('Could not refresh Google access — reconnect the connector.');
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw Errors.upstream('Google refresh returned no access token.');
    return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  },
};
