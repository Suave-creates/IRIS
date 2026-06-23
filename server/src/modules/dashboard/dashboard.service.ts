import type { RowDataPacket } from 'mysql2/promise';
import type {
  DashboardDeadline,
  DashboardNextMeeting,
  DashboardPriority,
  DashboardRisk,
  TaskPriority,
  Tone,
} from '@iris/shared';
import { query } from '../../db/pool.js';

// ── Row shapes (DB snake_case; DATE/DATETIME arrive as strings via dateStrings) ──

export interface PriorityRow extends RowDataPacket {
  id: string;
  rank: number;
  title: string;
  detail: string | null;
  tag: string | null;
  tag_tone: Tone;
}

export interface RiskRow extends RowDataPacket {
  id: string;
  title: string;
  detail: string | null;
  severity: TaskPriority;
}

interface ProjectDeadlineRow extends RowDataPacket {
  id: string;
  title: string;
  deadline: string; // 'YYYY-MM-DD'
}

interface JournalDeadlineRow extends RowDataPacket {
  id: string;
  title: string;
  due_date: string; // 'YYYY-MM-DD'
}

interface MeetingRow extends RowDataPacket {
  title: string;
  start_at: string; // 'YYYY-MM-DD HH:mm:ss' (UTC)
  location: string | null;
  notes: string | null;
  attendees: number;
}

interface CountRow extends RowDataPacket {
  n: number;
}

// ── Date helpers ────────────────────────────────────────────────────────────

const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MS_PER_DAY = 86_400_000;

/** UTC midnight for a given date — used so "days between" counts calendar days, not 24h windows. */
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days from `now` to `target` (negative = past). */
function daysUntil(now: Date, target: Date): number {
  return Math.round((startOfUtcDay(target) - startOfUtcDay(now)) / MS_PER_DAY);
}

/** Parse a 'YYYY-MM-DD' date string as a UTC calendar date. */
function parseDateOnly(s: string): Date {
  const parts = s.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d));
}

/** Parse a 'YYYY-MM-DD HH:mm:ss' (or ISO) DATETIME stored in UTC. */
function parseDateTimeUtc(s: string): Date {
  // dateStrings gives 'YYYY-MM-DD HH:mm:ss'; normalise to an ISO UTC instant.
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
}

function daysLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function deadlineTone(days: number): Tone {
  if (days <= 2) return 'danger';
  if (days <= 5) return 'warn';
  return 'neutral';
}

/** '2:00 PM' style 12-hour clock label for a UTC instant rendered in UTC. */
function timeLabel(d: Date): string {
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const meridiem = h < 12 ? 'AM' : 'PM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${meridiem}`;
}

/** 'in 1h 40m' / 'in 25m' / 'now' relative label between now and a future instant. */
function relativeInLabel(now: Date, target: Date): string {
  const totalMinutes = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return 'now';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `in ${h}h ${m}m`;
  if (h > 0) return `in ${h}h`;
  return `in ${m}m`;
}

/** "Tuesday · June 23" */
export function formatDateLabel(now: Date): string {
  const weekday = WEEKDAYS_LONG[now.getUTCDay()] ?? '';
  const month = MONTHS_LONG[now.getUTCMonth()] ?? '';
  return `${weekday} · ${month} ${now.getUTCDate()}`;
}

/** "Good morning/afternoon/evening, <FirstName>." */
export function formatGreeting(now: Date, fullName: string): string {
  const hour = now.getUTCHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = (fullName ?? '').trim().split(/\s+/)[0] || 'there';
  return `Good ${part}, ${firstName}.`;
}

// ── Data access (every query is tenant-scoped) ──────────────────────────────

async function getPriorities(tenantId: string): Promise<DashboardPriority[]> {
  const rows = await query<PriorityRow[]>(
    `SELECT id, rank, title, detail, tag, tag_tone
       FROM priorities
      WHERE tenant_id = :tid
      ORDER BY rank ASC, created_at ASC`,
    { tid: tenantId },
  );
  return rows.map((r) => ({
    id: r.id,
    rank: r.rank,
    title: r.title,
    detail: r.detail,
    tag: r.tag,
    tagTone: r.tag_tone,
  }));
}

async function getRisks(tenantId: string): Promise<DashboardRisk[]> {
  const rows = await query<RiskRow[]>(
    `SELECT id, title, detail, severity
       FROM risks
      WHERE tenant_id = :tid
      ORDER BY position ASC, created_at ASC`,
    { tid: tenantId },
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    severity: r.severity,
  }));
}

async function countPendingApprovals(tenantId: string): Promise<number> {
  const rows = await query<CountRow[]>(
    `SELECT COUNT(*) AS n FROM actions WHERE tenant_id = :tid AND status = 'pending'`,
    { tid: tenantId },
  );
  return rows[0]?.n ?? 0;
}

/**
 * Nearest 3 deadlines, merged from projects (future deadline) and not-done
 * journal tasks (future due date). Filtering to today-or-later happens in JS so
 * the calendar-day boundary matches the request-time `now`.
 */
async function getDeadlines(tenantId: string, now: Date): Promise<DashboardDeadline[]> {
  const todayIso = new Date(startOfUtcDay(now)).toISOString().slice(0, 10);

  const [projectRows, journalRows] = await Promise.all([
    query<ProjectDeadlineRow[]>(
      `SELECT id, name AS title, deadline
         FROM projects
        WHERE tenant_id = :tid
          AND deadline IS NOT NULL
          AND deadline >= :today`,
      { tid: tenantId, today: todayIso },
    ),
    query<JournalDeadlineRow[]>(
      `SELECT id, title, due_date
         FROM journal_tasks
        WHERE tenant_id = :tid
          AND done = 0
          AND due_date >= :today`,
      { tid: tenantId, today: todayIso },
    ),
  ]);

  const candidates: { id: string; title: string; date: Date }[] = [
    ...projectRows.map((r) => ({ id: r.id, title: r.title, date: parseDateOnly(r.deadline) })),
    ...journalRows.map((r) => ({ id: r.id, title: r.title, date: parseDateOnly(r.due_date) })),
  ];

  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());

  return candidates.slice(0, 3).map((c) => {
    const days = daysUntil(now, c.date);
    return {
      id: c.id,
      title: c.title,
      weekday: WEEKDAYS_SHORT[c.date.getUTCDay()] ?? '',
      day: c.date.getUTCDate(),
      daysLabel: daysLabel(days),
      tone: deadlineTone(days),
    };
  });
}

async function getNextMeeting(tenantId: string, now: Date): Promise<DashboardNextMeeting | null> {
  const rows = await query<MeetingRow[]>(
    `SELECT title, start_at, location, notes, attendees
       FROM calendar_events
      WHERE tenant_id = :tid
        AND start_at >= :now
      ORDER BY start_at ASC
      LIMIT 1`,
    { tid: tenantId, now: now.toISOString().slice(0, 19).replace('T', ' ') },
  );
  const row = rows[0];
  if (!row) return null;

  const start = parseDateTimeUtc(row.start_at);
  return {
    title: row.title,
    timeLabel: timeLabel(start),
    attendees: row.attendees,
    location: row.location,
    inLabel: relativeInLabel(now, start),
    brief: row.notes,
  };
}

export const dashboardService = {
  /** Assembles the full dashboard payload for a tenant at request time. */
  async load(tenantId: string, userName: string, now: Date) {
    const [priorities, risks, pendingApprovals, deadlines, nextMeeting] = await Promise.all([
      getPriorities(tenantId),
      getRisks(tenantId),
      countPendingApprovals(tenantId),
      getDeadlines(tenantId, now),
      getNextMeeting(tenantId, now),
    ]);

    return {
      dateLabel: formatDateLabel(now),
      greeting: formatGreeting(now, userName),
      briefing: {
        priorities: priorities.length,
        deadlines: deadlines.length,
        approvals: pendingApprovals,
      },
      priorities,
      pendingApprovals,
      deadlines,
      risks,
      nextMeeting,
      lastSync: 'just now',
    };
  },
};
