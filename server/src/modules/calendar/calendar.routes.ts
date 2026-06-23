import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CalendarEvent } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { calendarRepo, toCalendarEvent } from './calendar.repo.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const eventBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  color: z.string().regex(HEX_COLOR, 'Color must be a 7-char hex like #4b49d6'),
  location: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(10_000).nullish(),
});

const rangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

/** Converts an ISO instant to a UTC `YYYY-MM-DD HH:MM:SS` string for MySQL DATETIME (pool tz is 'Z'). */
function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/** Default window: Monday 00:00 → next Monday 00:00 (UTC) covering the current week. */
function currentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // List events within a range (defaults to the current week), ordered by start.
  app.get('/events', async (req) => {
    const me = currentUser(req);
    const q = rangeQuerySchema.parse(req.query);
    const week = currentWeekRange();
    const fromIso = q.from ?? week.from;
    const toIso = q.to ?? week.to;
    if (new Date(toIso).getTime() <= new Date(fromIso).getTime()) {
      throw Errors.validation('`to` must be after `from`.');
    }
    const rows = await calendarRepo.listByTenantInRange(
      me.tenantId,
      toMysqlDateTime(fromIso),
      toMysqlDateTime(toIso),
    );
    const data: CalendarEvent[] = rows.map(toCalendarEvent);
    return { data };
  });

  app.post('/events', async (req, reply) => {
    const me = currentUser(req);
    const body = eventBodySchema.parse(req.body);
    if (new Date(body.endAt).getTime() <= new Date(body.startAt).getTime()) {
      throw Errors.validation('`endAt` must be after `startAt`.');
    }
    const row = await calendarRepo.create({
      tenantId: me.tenantId,
      userId: me.id,
      title: body.title,
      startAt: toMysqlDateTime(body.startAt),
      endAt: toMysqlDateTime(body.endAt),
      color: body.color,
      location: body.location ?? null,
      notes: body.notes ?? null,
    });
    reply.code(201);
    return { data: toCalendarEvent(row) };
  });

  app.put('/events/:id', async (req) => {
    const me = currentUser(req);
    const { id: eventId } = idParamSchema.parse(req.params);
    const body = eventBodySchema.parse(req.body);
    if (new Date(body.endAt).getTime() <= new Date(body.startAt).getTime()) {
      throw Errors.validation('`endAt` must be after `startAt`.');
    }
    // Verify the event exists and belongs to the caller's tenant before mutating.
    const existing = await calendarRepo.findByIdForTenant(eventId, me.tenantId);
    if (!existing) throw Errors.notFound('Calendar event not found.');

    await calendarRepo.update(eventId, me.tenantId, {
      title: body.title,
      startAt: toMysqlDateTime(body.startAt),
      endAt: toMysqlDateTime(body.endAt),
      color: body.color,
      location: body.location ?? null,
      notes: body.notes ?? null,
    });
    const updated = await calendarRepo.findByIdForTenant(eventId, me.tenantId);
    if (!updated) throw Errors.notFound('Calendar event not found.');
    return { data: toCalendarEvent(updated) };
  });

  app.delete('/events/:id', async (req) => {
    const me = currentUser(req);
    const { id: eventId } = idParamSchema.parse(req.params);
    const affected = await calendarRepo.delete(eventId, me.tenantId);
    if (affected === 0) throw Errors.notFound('Calendar event not found.');
    return { data: { ok: true } };
  });
}
