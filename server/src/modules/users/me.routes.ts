import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { sessionService } from '../auth/session.service.js';
import { tenantRepo } from '../tenants/tenant.repo.js';
import { userRepo } from './user.repo.js';

const settingsSchema = z.object({
  continuousLearning: z.boolean(),
  autoSaveMemory: z.boolean(),
  retentionMonths: z.number().int().min(1).max(120),
  approveEmail: z.boolean(),
  approveCalendar: z.boolean(),
  approveDelete: z.boolean(),
  voiceReplies: z.boolean(),
  voice: z.string().min(1).max(60),
});

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // Full profile bundle for the app (user + tenant + settings).
  app.get('/', async (req) => {
    const me = currentUser(req);
    const [tenant, settings] = await Promise.all([
      tenantRepo.findById(me.tenantId),
      userRepo.getSettings(me.id),
    ]);
    return {
      data: {
        user: me,
        tenant: tenant
          ? { id: tenant.id, name: tenant.name, accentColor: tenant.accent_color }
          : null,
        settings,
      },
    };
  });

  app.get('/settings', async (req) => {
    const me = currentUser(req);
    return { data: await userRepo.getSettings(me.id) };
  });

  app.put('/settings', async (req) => {
    const me = currentUser(req);
    const body = settingsSchema.parse(req.body);
    await userRepo.upsertSettings(me.id, me.tenantId, body);
    return { data: await userRepo.getSettings(me.id) };
  });

  app.get('/sessions', async (req) => {
    const me = currentUser(req);
    const sessions = await sessionService.listActiveForUser(me.id);
    return {
      data: sessions.map((s) => ({
        id: s.id,
        current: s.id === req.sessionId,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
      })),
    };
  });

  // Sign out of every other session.
  app.delete('/sessions', async (req) => {
    const me = currentUser(req);
    const revoked = await sessionService.revokeAllForUser(me.id, req.sessionId ?? undefined);
    return { data: { revoked } };
  });
}
