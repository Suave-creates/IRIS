import type { FastifyInstance } from 'fastify';
import type { DashboardData } from '@iris/shared';
import { currentUser, requireAuth } from '../auth/guards.js';
import { dashboardService } from './dashboard.service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Aggregated, read-only dashboard payload for the current tenant.
  app.get('/', async (req) => {
    const me = currentUser(req);
    const now = new Date();
    const data: DashboardData = await dashboardService.load(me.tenantId, me.name, now);
    return { data };
  });
}
