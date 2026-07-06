import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cookieSecure, env, hasGoogleOAuth } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { auditService } from '../audit/audit.service.js';
import { authService } from './auth.service.js';
import { googleOAuth } from './google.js';
import { requireAuth } from './guards.js';
import {
  clearSessionCookie,
  sessionService,
  setSessionCookie,
} from './session.service.js';
import { toSessionUser, type UserRow } from './types.js';

const OAUTH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: cookieSecure,
  path: '/api/auth',
  signed: true,
  maxAge: 600, // 10 minutes
};

async function startSession(req: FastifyRequest, reply: FastifyReply, user: UserRow): Promise<void> {
  const session = await sessionService.create({
    userId: user.id,
    tenantId: user.tenant_id,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  });
  setSessionCookie(reply, session.id);
  await auditService.record({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    action: 'auth.login',
    ip: req.ip,
    logRef: req.id,
    metadata: { sessionId: session.id },
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // What sign-in methods are available (drives the login page).
  app.get('/providers', async () => ({
    data: { google: hasGoogleOAuth, password: env.AUTH_PASSWORD_ENABLED },
  }));

  // Current principal (200 with user|null — never a 401, to avoid client noise).
  app.get('/session', async (req) => ({ data: { user: req.authUser } }));

  // ── Google SSO ──
  app.get('/google/start', async (_req, reply) => {
    if (!hasGoogleOAuth) throw Errors.upstream('Google sign-in is not configured.', 'Ask an administrator to enable SSO.');
    const { url, state, verifier } = googleOAuth.createAuthRequest();
    reply.setCookie(env.OAUTH_COOKIE_NAME, JSON.stringify({ state, verifier }), OAUTH_COOKIE_OPTS);
    return reply.redirect(url);
  });

  app.get('/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const fail = (msg: string) => reply.redirect(`${env.WEB_BASE_URL}/login?error=${encodeURIComponent(msg)}`);

    if (q.error) return fail(q.error);
    if (!q.code || !q.state) return fail('missing_code');

    const raw = req.cookies[env.OAUTH_COOKIE_NAME];
    reply.clearCookie(env.OAUTH_COOKIE_NAME, { ...OAUTH_COOKIE_OPTS });
    const unsigned = raw ? req.unsignCookie(raw) : { valid: false, value: null };
    if (!unsigned.valid || !unsigned.value) return fail('expired');

    let stored: { state: string; verifier: string };
    try {
      stored = JSON.parse(unsigned.value);
    } catch {
      return fail('invalid_state');
    }
    if (stored.state !== q.state) return fail('state_mismatch');

    try {
      const { accessToken } = await googleOAuth.exchangeCode(q.code, stored.verifier);
      const profile = await googleOAuth.getProfile(accessToken);
      const user = await authService.provisionFromGoogle(profile);
      await startSession(req, reply, user);
      return reply.redirect(`${env.WEB_BASE_URL}/`);
    } catch (err) {
      req.log.warn({ err }, 'google sign-in failed');
      return fail('signin_failed');
    }
  });

  // ── Password (gated by AUTH_PASSWORD_ENABLED) ──
  const credsSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
  // Tight per-route throttle to blunt brute-force / credential stuffing.
  const credsRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/login', credsRateLimit, async (req, reply) => {
    const { email, password } = credsSchema.parse(req.body);
    const user = await authService.loginWithPassword({ email, password });
    await startSession(req, reply, user);
    return { data: { user: toSessionUser(user) } };
  });

  app.post('/register', credsRateLimit, async (req, reply) => {
    const body = credsSchema.extend({ name: z.string().min(1).max(160) }).parse(req.body);
    const user = await authService.registerWithPassword(body);
    await startSession(req, reply, user);
    return { data: { user: toSessionUser(user) } };
  });

  // ── Logout ──
  app.post('/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (req.sessionId) await sessionService.revoke(req.sessionId);
    clearSessionCookie(reply);
    await auditService.record({
      tenantId: req.authUser!.tenantId,
      actorUserId: req.authUser!.id,
      action: 'auth.logout',
      ip: req.ip,
      logRef: req.id,
    });
    return { data: { ok: true } };
  });
}
