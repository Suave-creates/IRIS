import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { randomToken } from '../../lib/crypto.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Default SSO scopes. Connector scopes (Gmail/Calendar/Drive) are added incrementally in M4. */
const SSO_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function pkce(): PkcePair {
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export const googleOAuth = {
  /** Generates a PKCE pair, state, and the Google consent URL to redirect to. */
  createAuthRequest(): { url: string; state: string; verifier: string } {
    const { verifier, challenge } = pkce();
    const state = randomToken(24);
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: SSO_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'online',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    });
    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, verifier };
  },

  /** Exchanges an authorization code (+ PKCE verifier) for an access token. */
  async exchangeCode(code: string, verifier: string): Promise<{ accessToken: string }> {
    const body = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw Errors.upstream('Google rejected the sign-in.', 'Try signing in again.');
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw Errors.upstream('Google did not return an access token.');
    return { accessToken: json.access_token };
  },

  /** Fetches the OpenID Connect profile for an access token. */
  async getProfile(accessToken: string): Promise<GoogleProfile> {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw Errors.upstream('Could not read your Google profile.');
    const json = (await res.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!json.sub || !json.email) throw Errors.upstream('Google profile was incomplete.');
    return {
      sub: json.sub,
      email: json.email.toLowerCase(),
      emailVerified: Boolean(json.email_verified),
      name: json.name ?? json.email.split('@')[0]!,
      picture: json.picture ?? null,
    };
  },
};
