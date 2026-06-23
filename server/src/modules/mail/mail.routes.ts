import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { googleClient } from '../../connectors/google/client.js';
import { syncProvider } from '../../connectors/sync.service.js';
import { mailRepo } from './mail.repo.js';

const listQuerySchema = z.object({
  category: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().max(255).optional(),
});

export async function mailRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /items?category=<cat|all>&q=<keyword> → MailItem[]
  app.get('/items', async (req) => {
    const me = currentUser(req);
    const { category, q } = listQuerySchema.parse(req.query);
    const items = await mailRepo.listByTenant(me.tenantId, { category, q });
    return { data: items };
  });

  // GET /stats → MailStats
  app.get('/stats', async (req) => {
    const me = currentUser(req);
    const stats = await mailRepo.statsByTenant(me.tenantId);
    return { data: stats };
  });

  // POST /sync → fetch recent Gmail and AI-triage it (summary/category/priority/tags).
  app.post('/sync', async (req) => {
    const me = currentUser(req);
    if (!(await googleClient.isConnected(me.tenantId))) {
      throw Errors.upstream('Google is not connected.', 'Connect Google on the Connectors page to fetch mail.');
    }
    const outcome = await syncProvider(me.tenantId, me.id, 'gmail');
    // syncProvider swallows its errors into ok:false — surface them so the client sees a real failure.
    if (!outcome.ok) {
      throw Errors.upstream(outcome.error ?? 'Mail sync failed.', 'Reconnect Google or retry shortly.');
    }
    return { data: outcome };
  });
}
