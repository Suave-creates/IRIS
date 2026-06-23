import type { FastifyInstance } from 'fastify';
import { currentUser, requireAuth } from '../auth/guards.js';
import { connectorRepo } from './connectors.repo.js';

export async function connectorsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // List every connector belonging to the caller's tenant.
  // (Real OAuth/sync arrives in M4 — this milestone only lists them.)
  app.get('/', async (req) => {
    const { tenantId } = currentUser(req);
    return { data: await connectorRepo.listByTenant(tenantId) };
  });
}
