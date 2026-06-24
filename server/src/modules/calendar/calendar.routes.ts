import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CalendarEvent } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { isoToMysqlUtc } from '../../lib/datetime.js';
import { googleClient } from '../../connectors/google/client.js';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  searchPeople,
  updateCalendarEvent,
} from '../../connectors/google/calendar.js';
import type { CalendarEventRow } from './calendar.repo.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { calendarRepo, toCalendarEvent } from './calendar.repo.js';

/**
 * The full Google event id for a row. Prefers the stored column; only falls back to the
 * PK-derived id when the PK provably WASN'T truncated (len < 40) — otherwise returns null
 * so we never patch/delete the wrong Google event from a truncated id.
 */
function googleIdOf(row: CalendarEventRow): string | null {
  if (row.google_event_id) return row.google_event_id;
  if (row.id.startsWith('evtg_') && row.id.length < 40) return row.id.slice(5);
  return null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const eventBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  color: z.string().regex(HEX_COLOR, 'Color must be a 7-char hex like #4b49d6'),
  location: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(10_000).nullish(),
  /** Guest email addresses to invite via Google Calendar. */
  attendees: z.array(z.string().trim().max(320)).max(50).optional(),
});

const rangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

/** Converts an ISO instant to a UTC `YYYY-MM-DD HH:MM:SS` string for MySQL DATETIME (pool tz is 'Z'). */
const toMysqlDateTime = isoToMysqlUtc;

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

    // Reflect into the user's Google Calendar (and invite guests) when connected.
    // On failure (usually the calendar.events scope not yet granted) we still save locally.
    let gid: string | undefined;
    let source: string | undefined;
    let googleEventId: string | undefined;
    let attendees = 0;
    if (await googleClient.isConnected(me.tenantId)) {
      try {
        const g = await createCalendarEvent(me.tenantId, {
          title: body.title,
          startAt: body.startAt,
          endAt: body.endAt,
          location: body.location ?? null,
          notes: body.notes ?? null,
          attendees: body.attendees ?? [],
        });
        if (g.googleId) {
          gid = `evtg_${g.googleId}`.slice(0, 40);
          source = 'gcalendar';
          googleEventId = g.googleId;
          attendees = g.attendees;
        }
      } catch (err) {
        req.log.warn({ err }, 'Google Calendar create failed; saving event locally only');
      }
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
      id: gid,
      source,
      attendees,
      googleEventId,
    });
    reply.code(201);
    return { data: toCalendarEvent(row) };
  });

  // Guest autocomplete — searches the user's contacts + Workspace directory.
  app.get('/guests', async (req) => {
    const me = currentUser(req);
    const { q } = z.object({ q: z.string().trim().max(120).optional() }).parse(req.query);
    if (!q || q.length < 2 || !(await googleClient.isConnected(me.tenantId))) return { data: [] };
    try {
      return { data: await searchPeople(me.tenantId, q) };
    } catch (err) {
      req.log.warn({ err }, 'guest search failed');
      return { data: [] };
    }
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

    // Mirror the edit to Google when it originated there. Guests are only sent when
    // supplied, so editing other fields can't wipe existing invitees.
    const guestsProvided = (body.attendees?.length ?? 0) > 0;
    let attendees: number | null = guestsProvided ? (body.attendees?.length ?? 0) : null;
    const googleId = existing.source === 'gcalendar' ? googleIdOf(existing) : null;
    if (existing.source === 'gcalendar' && !googleId) {
      req.log.warn({ id: existing.id }, 'gcalendar event has no resolvable Google id; editing locally only');
    }
    if (googleId && (await googleClient.isConnected(me.tenantId))) {
      try {
        const g = await updateCalendarEvent(me.tenantId, googleId, {
          title: body.title,
          startAt: body.startAt,
          endAt: body.endAt,
          location: body.location ?? null,
          notes: body.notes ?? null,
          attendees: body.attendees ?? [],
        });
        if (guestsProvided) attendees = g.attendees;
      } catch (err) {
        req.log.warn({ err }, 'Google Calendar update failed; updating event locally only');
      }
    }

    await calendarRepo.update(eventId, me.tenantId, {
      title: body.title,
      startAt: toMysqlDateTime(body.startAt),
      endAt: toMysqlDateTime(body.endAt),
      color: body.color,
      location: body.location ?? null,
      notes: body.notes ?? null,
      attendees,
    });
    const updated = await calendarRepo.findByIdForTenant(eventId, me.tenantId);
    if (!updated) throw Errors.notFound('Calendar event not found.');
    return { data: toCalendarEvent(updated) };
  });

  app.delete('/events/:id', async (req) => {
    const me = currentUser(req);
    const { id: eventId } = idParamSchema.parse(req.params);
    const existing = await calendarRepo.findByIdForTenant(eventId, me.tenantId);
    if (!existing) throw Errors.notFound('Calendar event not found.');

    // Remove from Google too when it lives there (and notify guests).
    const googleId = existing.source === 'gcalendar' ? googleIdOf(existing) : null;
    if (existing.source === 'gcalendar' && !googleId) {
      req.log.warn({ id: existing.id }, 'gcalendar event has no resolvable Google id; deleting locally only');
    }
    if (googleId && (await googleClient.isConnected(me.tenantId))) {
      try {
        await deleteCalendarEvent(me.tenantId, googleId);
      } catch (err) {
        req.log.warn({ err }, 'Google Calendar delete failed; removing event locally only');
      }
    }

    await calendarRepo.delete(eventId, me.tenantId);
    return { data: { ok: true } };
  });
}
