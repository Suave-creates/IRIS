import type { RowDataPacket } from 'mysql2/promise';
import type { Person, PersonCategory, PersonFunction, PersonInput, PersonLocation } from '@iris/shared';
import { execute, query, withTransaction } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import type { EngagementEventLite, PersonActionLite, PersonArtifactLite, PersonMeetingLite } from './people.derive.js';
import { deriveEngagement, freqLabel } from './people.derive.js';

// ── Row shapes (DB snake_case) ──────────────────────────────────────────────
interface PersonRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  name: string;
  category: PersonCategory;
  func: PersonFunction;
  location: PersonLocation;
  days: string | number[] | null;
  email: string | null;
  company: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
}

interface EngagementEventRow extends RowDataPacket {
  person_id: string;
  delta: number;
  occurred_on: string;
  title: string;
  created_at: string;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/** Parse the `days` JSON column, tolerating string or already-parsed forms. */
function parseDays(raw: string | number[] | null): number[] {
  if (Array.isArray(raw)) return raw.filter((d): d is number => typeof d === 'number' && Number.isInteger(d));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((d): d is number => typeof d === 'number' && Number.isInteger(d)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toEvent(row: EngagementEventRow): EngagementEventLite {
  return { delta: row.delta, occurredOn: row.occurred_on, title: row.title };
}

/** Maps a DB row → the shared Person DTO, deriving cadence + engagement from the person's events. */
function toPerson(row: PersonRow, events: EngagementEventLite[]): Person {
  const days = parseDays(row.days);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    func: row.func,
    location: row.location,
    days,
    cadence: freqLabel(days),
    email: row.email ?? null,
    company: row.company ?? null,
    role: row.role ?? null,
    engagement: deriveEngagement(days, events),
  };
}

/** Emails are stored + matched lowercase (attendee lists arrive in mixed case). */
function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase() ?? '';
  return trimmed ? trimmed.slice(0, 255) : null;
}

/** Parse a JSON string[] column defensively (topics). */
function parseStringList(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
}

interface PersonMeetingRow extends RowDataPacket {
  id: string;
  title: string;
  started_at: string;
  summary: string | null;
  topics: unknown;
  source: string;
}

interface PersonActionRowDb extends RowDataPacket {
  meeting_id: string;
  meeting_title: string;
  title: string;
  due_date: string | null;
  done: number;
}

interface PersonArtifactRowDb extends RowDataPacket {
  title: string;
  started_at: string;
  artifacts: unknown;
}

/** Parse one meeting's artifacts JSON column defensively ({kind,label,ref} rows only). */
function parseArtifactList(raw: unknown): { kind: string; label: string; ref: string | null }[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => typeof a.kind === 'string' && typeof a.label === 'string' && (a.label as string).length > 0)
    .map((a) => ({
      kind: a.kind as string,
      label: a.label as string,
      ref: typeof a.ref === 'string' && a.ref ? a.ref : null,
    }));
}

// ── Repository ──────────────────────────────────────────────────────────────
export const peopleRepo = {
  /**
   * Lists the roster with computed engagement per person. Every engagement
   * event for the tenant is loaded in one query (oldest first, so the latest
   * event's title wins as boostTitle) and grouped per person for the derive.
   */
  async listByTenant(tenantId: string): Promise<Person[]> {
    const [rows, events] = await Promise.all([
      query<PersonRow[]>('SELECT * FROM people WHERE tenant_id = :tid ORDER BY created_at, id', { tid: tenantId }),
      query<EngagementEventRow[]>(
        `SELECT person_id, delta, occurred_on, title, created_at
           FROM engagement_events
          WHERE tenant_id = :tid
          ORDER BY created_at, id`,
        { tid: tenantId },
      ),
    ]);
    const byPerson = new Map<string, EngagementEventLite[]>();
    for (const e of events) {
      const list = byPerson.get(e.person_id);
      const lite = toEvent(e);
      if (list) list.push(lite);
      else byPerson.set(e.person_id, [lite]);
    }
    return rows.map((r) => toPerson(r, byPerson.get(r.id) ?? []));
  },

  /** Fetches one person scoped to the tenant, with derived engagement, or null. */
  async getById(tenantId: string, personId: string): Promise<Person | null> {
    const found = await this.getWithEvents(tenantId, personId);
    return found?.person ?? null;
  },

  /**
   * Fetches a person plus their engagement events in one round (the context
   * endpoint needs both — this avoids querying the events twice).
   */
  async getWithEvents(
    tenantId: string,
    personId: string,
  ): Promise<{ person: Person; events: EngagementEventLite[] } | null> {
    const [rows, events] = await Promise.all([
      query<PersonRow[]>('SELECT * FROM people WHERE id = :pid AND tenant_id = :tid', {
        pid: personId,
        tid: tenantId,
      }),
      this.eventsForPerson(tenantId, personId),
    ]);
    const row = rows[0];
    if (!row) return null;
    return { person: toPerson(row, events), events };
  },

  /** Processed meetings the person took part in (participants JSON contains their name), newest first. */
  async meetingsForPerson(tenantId: string, personName: string): Promise<PersonMeetingLite[]> {
    const rows = await query<PersonMeetingRow[]>(
      `SELECT id, title, started_at, summary, topics, source
         FROM meetings
        WHERE tenant_id = :tid AND JSON_CONTAINS(participants, JSON_QUOTE(:name), '$')
        ORDER BY started_at DESC, created_at DESC
        LIMIT 50`,
      { tid: tenantId, name: personName },
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      startedAt: r.started_at,
      summary: r.summary ?? '',
      topics: parseStringList(r.topics),
      source: r.source,
    }));
  },

  /**
   * Action items owned by the person across processed meetings. Owners are
   * stored as short names, so this matches the first name or the full name
   * (case-insensitive) — same-first-name collisions are accepted for now.
   */
  async actionsForPerson(tenantId: string, personName: string): Promise<PersonActionLite[]> {
    const firstName = personName.trim().split(/\s+/)[0] ?? personName;
    const rows = await query<PersonActionRowDb[]>(
      `SELECT ma.meeting_id, m.title AS meeting_title, ma.title, ma.due_date, ma.done
         FROM meeting_actions ma
         JOIN meetings m ON m.id = ma.meeting_id
        WHERE m.tenant_id = :tid AND LOWER(ma.owner) IN (LOWER(:first), LOWER(:full))
        ORDER BY ma.done, ma.due_date IS NULL, ma.due_date, m.started_at DESC
        LIMIT 100`,
      { tid: tenantId, first: firstName, full: personName.trim() },
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      meetingTitle: r.meeting_title,
      title: r.title,
      dueDate: r.due_date,
      done: r.done === 1,
    }));
  },

  /**
   * Artifacts (docs/repos/tickets/links) extracted from meetings the person
   * participated in, flattened newest-meeting first and capped at 20 — feeds
   * the drawer's Files panel.
   */
  async artifactsForPerson(tenantId: string, personName: string): Promise<PersonArtifactLite[]> {
    const rows = await query<PersonArtifactRowDb[]>(
      `SELECT title, started_at, artifacts
         FROM meetings
        WHERE tenant_id = :tid AND JSON_CONTAINS(participants, JSON_QUOTE(:name), '$')
          AND artifacts IS NOT NULL
        ORDER BY started_at DESC, created_at DESC
        LIMIT 50`,
      { tid: tenantId, name: personName },
    );
    const out: PersonArtifactLite[] = [];
    for (const row of rows) {
      for (const artifact of parseArtifactList(row.artifacts)) {
        out.push({ ...artifact, meetingTitle: row.title, startedAt: row.started_at });
        if (out.length >= 20) return out;
      }
    }
    return out;
  },

  /** Engagement events for one person, oldest first (feeds the context endpoint). */
  async eventsForPerson(tenantId: string, personId: string): Promise<EngagementEventLite[]> {
    const rows = await query<EngagementEventRow[]>(
      `SELECT person_id, delta, occurred_on, title, created_at
         FROM engagement_events
        WHERE tenant_id = :tid AND person_id = :pid
        ORDER BY created_at, id`,
      { tid: tenantId, pid: personId },
    );
    return rows.map(toEvent);
  },

  /** Adds a person to the roster and returns the persisted DTO. */
  async create(tenantId: string, input: PersonInput): Promise<Person> {
    const personId = id('per');
    await execute(
      `INSERT INTO people (id, tenant_id, name, category, func, location, days, email, company, role)
       VALUES (:id, :tid, :name, :category, :func, :location, :days, :email, :company, :role)`,
      {
        id: personId,
        tid: tenantId,
        name: input.name.slice(0, 160),
        category: input.category,
        func: input.func,
        location: input.location,
        days: JSON.stringify(input.days),
        email: normalizeEmail(input.email),
        company: input.company?.trim().slice(0, 160) || null,
        role: input.role?.trim().slice(0, 160) || null,
      },
    );
    const created = await this.getById(tenantId, personId);
    if (!created) throw new Error('Failed to create person');
    return created;
  },

  /**
   * Adds many people in one transaction (bulk roster import) and returns the
   * persisted DTOs. Callers pre-filter duplicates; this inserts everything given.
   */
  async createMany(tenantId: string, inputs: PersonInput[]): Promise<Person[]> {
    if (!inputs.length) return [];
    const ids = inputs.map(() => id('per'));
    await withTransaction(async (conn) => {
      const params: Record<string, unknown> = {};
      const tuples = inputs.map((input, i) => {
        params[`id${i}`] = ids[i];
        params[`t${i}`] = tenantId;
        params[`n${i}`] = input.name.slice(0, 160);
        params[`c${i}`] = input.category;
        params[`f${i}`] = input.func;
        params[`l${i}`] = input.location;
        params[`d${i}`] = JSON.stringify(input.days);
        params[`e${i}`] = normalizeEmail(input.email);
        params[`co${i}`] = input.company?.trim().slice(0, 160) || null;
        params[`r${i}`] = input.role?.trim().slice(0, 160) || null;
        return `(:id${i}, :t${i}, :n${i}, :c${i}, :f${i}, :l${i}, :d${i}, :e${i}, :co${i}, :r${i})`;
      });
      await conn.execute(
        `INSERT INTO people (id, tenant_id, name, category, func, location, days, email, company, role) VALUES ${tuples.join(', ')}`,
        params as never,
      );
    });
    const marks = ids.map((_, i) => `:p${i}`).join(', ');
    const params: Record<string, unknown> = { tid: tenantId };
    ids.forEach((pid, i) => {
      params[`p${i}`] = pid;
    });
    const rows = await query<PersonRow[]>(
      `SELECT * FROM people WHERE tenant_id = :tid AND id IN (${marks}) ORDER BY created_at, id`,
      params,
    );
    // Fresh rows have no engagement events yet.
    return rows.map((r) => toPerson(r, []));
  },

  /** Updates a person; only the keys present in `patch` change (COALESCE semantics). */
  async update(tenantId: string, personId: string, patch: Partial<PersonInput>): Promise<boolean> {
    const result = await execute(
      `UPDATE people SET
         name = COALESCE(:name, name),
         category = COALESCE(:category, category),
         func = COALESCE(:func, func),
         location = COALESCE(:location, location),
         days = COALESCE(:days, days),
         email = COALESCE(:email, email),
         company = COALESCE(:company, company),
         role = COALESCE(:role, role)
       WHERE id = :pid AND tenant_id = :tid`,
      {
        pid: personId,
        tid: tenantId,
        name: patch.name?.slice(0, 160) ?? null,
        category: patch.category ?? null,
        func: patch.func ?? null,
        location: patch.location ?? null,
        days: patch.days ? JSON.stringify(patch.days) : null,
        email: normalizeEmail(patch.email),
        company: patch.company?.trim().slice(0, 160) || null,
        role: patch.role?.trim().slice(0, 160) || null,
      },
    );
    return result.affectedRows > 0;
  },

  /** Removes a person (their engagement events cascade). Returns true if a row was deleted. */
  async remove(tenantId: string, personId: string): Promise<boolean> {
    const result = await execute('DELETE FROM people WHERE id = :pid AND tenant_id = :tid', {
      pid: personId,
      tid: tenantId,
    });
    return result.affectedRows > 0;
  },

  /** Removes many people at once (bulk remove). Returns how many rows were deleted. */
  async removeMany(tenantId: string, personIds: string[]): Promise<number> {
    if (!personIds.length) return 0;
    const params: Record<string, unknown> = { tid: tenantId };
    const marks = personIds.map((pid, i) => {
      params[`p${i}`] = pid;
      return `:p${i}`;
    });
    const result = await execute(
      `DELETE FROM people WHERE tenant_id = :tid AND id IN (${marks.join(', ')})`,
      params,
    );
    return result.affectedRows;
  },
};
