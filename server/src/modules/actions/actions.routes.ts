import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ActionProposal, ActionStatus } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { auditService } from '../audit/audit.service.js';
import { actionRepo, toActionProposal } from './actions.repo.js';
import { executeApprovedAction } from './executor.js';

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'executed', 'failed']).optional(),
});

const idParamsSchema = z.object({
  id: z.string().min(1),
});

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /?status=pending → ActionProposal[]
  app.get('/', async (req) => {
    const me = currentUser(req);
    const { status } = listQuerySchema.parse(req.query);
    const rows = await actionRepo.listByTenant(me.tenantId, status as ActionStatus | undefined);
    const data: ActionProposal[] = rows.map(toActionProposal);
    return { data };
  });

  // POST /:id/approve → ActionProposal
  app.post('/:id/approve', async (req) => {
    const me = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);

    const existing = await actionRepo.findByIdForTenant(me.tenantId, id);
    if (!existing) throw Errors.notFound('Action not found.');
    if (existing.status !== 'pending') {
      throw Errors.conflict('This action has already been decided.');
    }

    await actionRepo.decide(me.tenantId, id, 'approved');
    // Execute internal actions immediately (task/event/memory); external ones
    // stay 'approved' pending connector delivery (M4).
    const finalStatus = await executeApprovedAction({ ...existing, status: 'approved' });

    await auditService.record({
      tenantId: me.tenantId,
      actorUserId: me.id,
      action: finalStatus === 'failed' ? 'action.failed' : 'action.approved',
      targetType: 'action',
      targetId: id,
      metadata: { kind: existing.kind, target: existing.target, result: finalStatus },
      ip: req.ip,
    });

    const updated = await actionRepo.findByIdForTenant(me.tenantId, id);
    if (!updated) throw Errors.notFound('Action not found.');
    return { data: toActionProposal(updated) };
  });

  // POST /:id/reject → ActionProposal
  app.post('/:id/reject', async (req) => {
    const me = currentUser(req);
    const { id } = idParamsSchema.parse(req.params);

    const existing = await actionRepo.findByIdForTenant(me.tenantId, id);
    if (!existing) throw Errors.notFound('Action not found.');
    if (existing.status !== 'pending') {
      throw Errors.conflict('This action has already been decided.');
    }

    await actionRepo.decide(me.tenantId, id, 'rejected');

    await auditService.record({
      tenantId: me.tenantId,
      actorUserId: me.id,
      action: 'action.rejected',
      targetType: 'action',
      targetId: id,
      metadata: { kind: existing.kind, target: existing.target },
      ip: req.ip,
    });

    const updated = await actionRepo.findByIdForTenant(me.tenantId, id);
    if (!updated) throw Errors.notFound('Action not found.');
    return { data: toActionProposal(updated) };
  });

  // POST /approve-all → { approved: <count> }
  app.post('/approve-all', async (req) => {
    const me = currentUser(req);
    const pending = await actionRepo.listByTenant(me.tenantId, 'pending');
    let approved = 0;
    for (const row of pending) {
      await actionRepo.decide(me.tenantId, row.id, 'approved');
      await executeApprovedAction({ ...row, status: 'approved' });
      approved++;
    }

    await auditService.record({
      tenantId: me.tenantId,
      actorUserId: me.id,
      action: 'action.approved',
      targetType: 'action',
      targetId: null,
      metadata: { bulk: true, approved },
      ip: req.ip,
    });

    return { data: { approved } };
  });
}
