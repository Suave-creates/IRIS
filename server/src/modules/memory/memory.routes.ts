import type { FastifyInstance } from 'fastify';
import type { MemoryOverview } from '@iris/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { memoryRepo } from './memory.repo.js';

const RECENT_LIMIT = 8;

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /overview — counts + recent memories + knowledge graph.
  app.get('/overview', async (req) => {
    const { tenantId } = currentUser(req);
    const [counts, recent, graph] = await Promise.all([
      memoryRepo.counts(tenantId),
      memoryRepo.recent(tenantId, RECENT_LIMIT),
      memoryRepo.graph(tenantId),
    ]);
    const data: MemoryOverview = { counts, recent, graph };
    return { data };
  });

  // DELETE /:id — forget a memory (tenant-verified).
  app.delete('/:id', async (req) => {
    const { tenantId } = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await memoryRepo.deleteForTenant(tenantId, id);
    if (!deleted) throw Errors.notFound('That memory does not exist.');
    return { data: { ok: true } };
  });
}
