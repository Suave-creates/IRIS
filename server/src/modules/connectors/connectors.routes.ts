import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONNECTOR_PROVIDERS } from '@iris/shared';
import { env, hasGoogleOAuth, isProd } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { auditService } from '../audit/audit.service.js';
import { connectorOAuth } from '../../connectors/google/oauth.js';
import { connectService } from '../../connectors/connect.service.js';
import { CONNECTORS } from '../../connectors/registry.js';
import { syncAll, syncProvider } from '../../connectors/sync.service.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { connectorRepo } from './connectors.repo.js';

const COAUTH_COOKIE = 'iris_coauth';
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/api/connectors', signed: true, maxAge: 600 };
const providerParam = z.object({ provider: z.enum(CONNECTOR_PROVIDERS) });

export async function connectorsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const { tenantId } = currentUser(req);
    return { data: await connectorRepo.listByTenant(tenantId) };
  });

  // Begin connector authorization (Google grant). 302 → Google consent.
  app.get('/:provider/connect', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    if (!CONNECTORS[provider].google) {
      throw Errors.validation(`${CONNECTORS[provider].displayName} connect isn't available yet.`);
    }
    if (!hasGoogleOAuth) throw Errors.upstream('Google is not configured.', 'Set GOOGLE_CLIENT_ID/SECRET.');
    const { url, state, verifier } = connectorOAuth.createAuthRequest();
    reply.setCookie(COAUTH_COOKIE, JSON.stringify({ state, verifier }), cookieOpts);
    return reply.redirect(url);
  });

  // Reconnect is the same authorization flow.
  app.get('/:provider/reconnect', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    if (!CONNECTORS[provider].google || !hasGoogleOAuth) throw Errors.validation('Reconnect not available.');
    const { url, state, verifier } = connectorOAuth.createAuthRequest();
    reply.setCookie(COAUTH_COOKIE, JSON.stringify({ state, verifier }), cookieOpts);
    return reply.redirect(url);
  });

  // Google connector OAuth callback → store grant, mark connected.
  app.get('/google/callback', async (req, reply) => {
    const me = currentUser(req);
    const q = req.query as { code?: string; state?: string; error?: string };
    const fail = (m: string) => reply.redirect(`${env.WEB_BASE_URL}/connectors?error=${encodeURIComponent(m)}`);
    if (q.error) return fail(q.error);
    if (!q.code || !q.state) return fail('missing_code');

    const raw = req.cookies[COAUTH_COOKIE];
    reply.clearCookie(COAUTH_COOKIE, { ...cookieOpts });
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
      const tokens = await connectorOAuth.exchangeCode(q.code, stored.verifier);
      await connectService.connectGoogle(me.tenantId, tokens);
      await auditService.record({
        tenantId: me.tenantId, actorUserId: me.id, action: 'connector.connected',
        targetType: 'connector', targetId: 'google', ip: req.ip, logRef: req.id,
      });
      return reply.redirect(`${env.WEB_BASE_URL}/connectors?connected=google`);
    } catch (err) {
      req.log.warn({ err }, 'connector authorization failed');
      return fail('connect_failed');
    }
  });

  app.post('/:provider/disconnect', async (req) => {
    const me = currentUser(req);
    const { provider } = providerParam.parse(req.params);
    await connectService.disconnect(me.tenantId, provider);
    await auditService.record({
      tenantId: me.tenantId, actorUserId: me.id, action: 'connector.disconnected',
      targetType: 'connector', targetId: provider, ip: req.ip,
    });
    return { data: { ok: true } };
  });

  app.post('/:provider/sync', async (req) => {
    const me = currentUser(req);
    const { provider } = providerParam.parse(req.params);
    const outcome = await syncProvider(me.tenantId, me.id, provider);
    return { data: outcome };
  });

  // "Sync Everything" — SSE progress across all connected connectors.
  app.post('/sync-all', async (req, reply) => {
    const me = currentUser(req);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const outcomes = await syncAll(me.tenantId, me.id, (e) => send('progress', e));
      const imported = outcomes.reduce((n, o) => n + o.imported, 0);
      send('done', { outcomes, imported });
    } catch (err) {
      req.log.error({ err }, 'sync-all failed');
      send('error', { message: 'Sync failed. Please try again.' });
    } finally {
      raw.end();
    }
  });
}
