import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
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
}
