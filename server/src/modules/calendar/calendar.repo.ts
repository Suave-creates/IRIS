import type { RowDataPacket } from 'mysql2/promise';
import type { CalendarEvent } from '@iris/shared';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

/** Row shape for `calendar_events`. DATETIME/TIMESTAMP come back as strings (dateStrings). */
export interface CalendarEventRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  start_at: string;
  end_at: string;
  color: string;
  location: string | null;
  notes: string | null;
  attendees: number;
  source: string;
  google_event_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The DB stores UTC wall-clock and returns "YYYY-MM-DD HH:MM:SS" (dateStrings: true).
 * Browsers parse that ambiguously (often as local time, or fail outright), which made
 * events collapse to the grid's start hour. Normalize to unambiguous ISO-8601 Z.
 */
function toIso(dt: string): string {
  if (!dt) return dt;
  const d = new Date(/[TZ]/.test(dt) ? dt : `${dt.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? dt : d.toISOString();
}

/** Maps a DB row (snake_case) to the CalendarEvent DTO (camelCase). */
export function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    color: row.color,
    location: row.location ?? null,
    notes: row.notes ?? null,
    attendees: row.attendees,
  };
}

export interface CreateEventInput {
  tenantId: string;
  userId: string;
  title: string;
  startAt: string;
  endAt: string;
  color: string;
  location?: string | null;
  notes?: string | null;
  /** Explicit id (e.g. evtg_<googleId>) — defaults to a fresh evt_ id. */
  id?: string;
  /** Origin tag: 'manual' (default) or 'gcalendar' when mirrored from Google. */
  source?: string;
  /** Guest count to store. */
  attendees?: number;
  /** Full Google Calendar event id (for later patch/delete). */
  googleEventId?: string | null;
}

export interface UpdateEventInput {
  title: string;
  startAt: string;
  endAt: string;
  color: string;
  location?: string | null;
  notes?: string | null;
  /** New guest count (null preserves the current value). */
  attendees?: number | null;
}

export const calendarRepo = {
  /** Events overlapping [from, to) for a tenant, ordered by start. */
  async listByTenantInRange(tenantId: string, from: string, to: string): Promise<CalendarEventRow[]> {
    return query<CalendarEventRow[]>(
      `SELECT * FROM calendar_events
       WHERE tenant_id = :tid AND start_at < :to AND end_at > :from
       ORDER BY start_at`,
      { tid: tenantId, from, to },
    );
  },

  /** Fetches a single event scoped to the tenant (tenant isolation). */
  async findByIdForTenant(eventId: string, tenantId: string): Promise<CalendarEventRow | null> {
    const rows = await query<CalendarEventRow[]>(
      'SELECT * FROM calendar_events WHERE id = :id AND tenant_id = :tid',
      { id: eventId, tid: tenantId },
    );
    return rows[0] ?? null;
  },

  async create(input: CreateEventInput): Promise<CalendarEventRow> {
    const eventId = input.id ?? id('evt');
    await execute(
      `INSERT INTO calendar_events (id, tenant_id, user_id, title, start_at, end_at, color, location, notes, attendees, source, google_event_id)
       VALUES (:id, :tid, :uid, :title, :start, :end, :color, :location, :notes, :att, :source, :gid)
       ON DUPLICATE KEY UPDATE title=VALUES(title), start_at=VALUES(start_at), end_at=VALUES(end_at),
         color=VALUES(color), location=VALUES(location), notes=VALUES(notes), attendees=VALUES(attendees),
         google_event_id=VALUES(google_event_id)`,
      {
        id: eventId,
        tid: input.tenantId,
        uid: input.userId,
        title: input.title,
        start: input.startAt,
        end: input.endAt,
        color: input.color,
        location: input.location ?? null,
        notes: input.notes ?? null,
        att: input.attendees ?? 0,
        source: input.source ?? 'manual',
        gid: input.googleEventId ?? null,
      },
    );
    const created = await this.findByIdForTenant(eventId, input.tenantId);
    if (!created) throw new Error('Failed to create calendar event');
    return created;
  },

  /** Updates an event in place. Caller must have already verified tenant ownership. */
  async update(eventId: string, tenantId: string, patch: UpdateEventInput): Promise<void> {
    await execute(
      `UPDATE calendar_events SET
         title    = :title,
         start_at = :start,
         end_at   = :end,
         color    = :color,
         location = :location,
         notes    = :notes,
         attendees = COALESCE(:att, attendees)
       WHERE id = :id AND tenant_id = :tid`,
      {
        id: eventId,
        tid: tenantId,
        title: patch.title,
        start: patch.startAt,
        end: patch.endAt,
        color: patch.color,
        location: patch.location ?? null,
        notes: patch.notes ?? null,
        att: patch.attendees ?? null,
      },
    );
  },

  async delete(eventId: string, tenantId: string): Promise<number> {
    const result = await execute(
      'DELETE FROM calendar_events WHERE id = :id AND tenant_id = :tid',
      { id: eventId, tid: tenantId },
    );
    return result.affectedRows;
  },
};
