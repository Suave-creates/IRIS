import type { FastifyInstance } from 'fastify';
import { hasAnthropic, hasGoogleOAuth } from '../../config/env.js';
import { pingDb } from '../../db/pool.js';

const startedAt = Date.now();

/**
 * Liveness + readiness endpoints. `/health` is cheap (no I/O) for infra probes;
 * `/health/ready` checks dependencies and reports degraded subsystems without
 * crashing when, say, the database is briefly unreachable.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    data: {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
    },
  }));

  app.get('/ready', async (_req, reply) => {
    let db: 'ok' | 'down' = 'ok';
    try {
      await pingDb();
    } catch {
      db = 'down';
    }
    const checks = {
      db,
      anthropic: hasAnthropic ? 'configured' : 'unconfigured',
      googleOAuth: hasGoogleOAuth ? 'configured' : 'unconfigured',
    };
    const ready = db === 'ok';
    return reply.status(ready ? 200 : 503).send({ data: { ready, checks } });
  });
}
