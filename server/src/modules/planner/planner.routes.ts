import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { PLANNER_COLORS } from '@iris/shared';
import { plannerRepo } from './planner.repo.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');
const colorSchema = z.enum(PLANNER_COLORS);

const rangeSchema = z.object({ from: ymd, to: ymd });
const spanSchema = z.number().int().min(1).max(31);
const createSchema = z.object({
  date: ymd,
  title: z.string().trim().min(1).max(255),
  fullDay: z.boolean().optional(),
  span: spanSchema.optional(),
  color: colorSchema.optional(),
  notes: z.string().trim().max(2000).nullish(),
});
const updateSchema = z.object({
  date: ymd.optional(),
  title: z.string().trim().min(1).max(255).optional(),
  fullDay: z.boolean().optional(),
  span: spanSchema.optional(),
  color: colorSchema.optional(),
  position: z.number().int().min(0).max(100000).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const reorderSchema = z.object({ date: ymd, ids: z.array(z.string().min(1).max(40)).min(1).max(100) });
const rolloverSchema = z.object({ weekStart: ymd });
const idParams = z.object({ id: z.string().min(1) });

export async function plannerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /?from=YYYY-MM-DD&to=YYYY-MM-DD → the user's blocks in that window.
  app.get('/', async (req) => {
    const me = currentUser(req);
    const { from, to } = rangeSchema.parse(req.query);
    return { data: await plannerRepo.listByRange(me.tenantId, me.id, from, to) };
  });

  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = createSchema.parse(req.body);
    return { data: await plannerRepo.create(me.tenantId, me.id, body) };
  });

  app.patch('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    const patch = updateSchema.parse(req.body);
    if (!(await plannerRepo.update(me.tenantId, me.id, id, patch))) throw Errors.notFound('Block not found.');
    const updated = await plannerRepo.getById(me.tenantId, me.id, id);
    if (!updated) throw Errors.notFound('Block not found.');
    return { data: updated };
  });

  app.delete('/:id', async (req) => {
    const me = currentUser(req);
    const { id } = idParams.parse(req.params);
    if (!(await plannerRepo.remove(me.tenantId, me.id, id))) throw Errors.notFound('Block not found.');
    return { data: { ok: true } };
  });

  // Move / reorder: the full ordered id list that now belongs to `date`.
  app.post('/reorder', async (req) => {
    const me = currentUser(req);
    const { date, ids } = reorderSchema.parse(req.body);
    await plannerRepo.reorderForDay(me.tenantId, me.id, date, ids);
    return { data: { ok: true } };
  });

  // Roll the given week's plan forward by 7 days (copy).
  app.post('/rollover', async (req) => {
    const me = currentUser(req);
    const { weekStart } = rolloverSchema.parse(req.body);
    const copied = await plannerRepo.rolloverWeek(me.tenantId, me.id, weekStart);
    return { data: { copied } };
  });
}
