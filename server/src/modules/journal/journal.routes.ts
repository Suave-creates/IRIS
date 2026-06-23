import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { journalRepo } from './journal.repo.js';

// YYYY-MM-DD (calendar dates). Kept strict so the BETWEEN range is well-formed.
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');

// HH:MM or HH:MM:SS (fits the VARCHAR(8) due_time column).
const timeOnly = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected an HH:MM or HH:MM:SS time.');

const listQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

const taskBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  dueDate: dateOnly,
  dueTime: timeOnly.nullish(),
  priority: z.enum(['high', 'med', 'low']),
  done: z.boolean().optional(),
  detail: z.string().max(10_000).nullish(),
});

const idParamsSchema = z.object({
  id: z.string().min(1),
});

/** Returns the first/last day of the month containing `ref` as YYYY-MM-DD. */
function monthBounds(ref: Date): { from: string; to: string } {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // List the caller's own tasks in a date range (default: current month).
  app.get('/tasks', async (req) => {
    const me = currentUser(req);
    const q = listQuerySchema.parse(req.query);
    const bounds = monthBounds(new Date());
    const from = q.from ?? bounds.from;
    const to = q.to ?? bounds.to;
    if (from > to) {
      throw Errors.validation('"from" must not be after "to".');
    }
    const data = await journalRepo.listForUser(me.tenantId, me.id, from, to);
    return { data };
  });

  // Create a task owned by the caller.
  app.post('/tasks', async (req, reply) => {
    const me = currentUser(req);
    const body = taskBodySchema.parse(req.body);
    const data = await journalRepo.create(me.tenantId, me.id, body);
    reply.code(201);
    return { data };
  });

  // Update a task the caller owns (tenant + user re-checked in the repo).
  app.put('/tasks/:id', async (req) => {
    const me = currentUser(req);
    const { id: taskId } = idParamsSchema.parse(req.params);
    const body = taskBodySchema.parse(req.body);
    const data = await journalRepo.update(me.tenantId, me.id, taskId, body);
    if (!data) throw Errors.notFound('Journal task not found.');
    return { data };
  });

  // Delete a task the caller owns.
  app.delete('/tasks/:id', async (req) => {
    const me = currentUser(req);
    const { id: taskId } = idParamsSchema.parse(req.params);
    const removed = await journalRepo.remove(me.tenantId, me.id, taskId);
    if (!removed) throw Errors.notFound('Journal task not found.');
    return { data: { ok: true } };
  });
}
