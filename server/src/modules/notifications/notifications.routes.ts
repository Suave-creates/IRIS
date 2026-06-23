import type { FastifyInstance } from 'fastify';
import { currentUser, requireAuth } from '../auth/guards.js';
import { notificationsRepo } from './notifications.repo.js';

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Latest 20 notifications for the caller (own + tenant scoped), newest first.
  app.get('/', async (req) => {
    const me = currentUser(req);
    const notifications = await notificationsRepo.listRecent(me.tenantId, me.id);
    return { data: notifications };
  });

  // Mark all of the caller's notifications as read.
  app.post('/read-all', async (req) => {
    const me = currentUser(req);
    await notificationsRepo.markAllRead(me.tenantId, me.id);
    return { data: { ok: true } };
  });
}
