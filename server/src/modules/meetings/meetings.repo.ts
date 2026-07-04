import type { RowDataPacket } from 'mysql2/promise';
import type {
  Meeting,
  MeetingActionRow,
  MeetingArtifact,
  MeetingCtxUpdate,
  MeetingDecisionRow,
  MeetingMode,
  MeetingSentiment,
  MeetingTranscriptLine,
} from '@iris/shared';
import { execute, query, withTransaction } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import {
  dateLabel,
  dayOfMonth,
  isTodayDate,
  mmss,
  timeOfDayLabel,
  todayDate,
  weekdayUpperOf,
} from '../../lib/design-frame.js';

// ── Row shapes (DB snake_case) ──────────────────────────────────────────────

interface MeetingRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  title: string;
  mode: MeetingMode;
  started_at: string;
  duration_secs: number;
  sentiment: MeetingSentiment;
  summary: string | null;
  topics: string | unknown[] | null;
  participants: string | unknown[] | null;
  risks: string | unknown[] | null;
  followups: string | unknown[] | null;
  ctx_updates: string | unknown[] | null;
  artifacts: string | unknown[] | null;
  carryovers: string | unknown[] | null;
  link_note: string | null;
  source: string;
  stt_engine: string | null;
  demo_key: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RecentMeetingRow extends RowDataPacket {
  id: string;
  title: string;
  started_at: string;
  summary: string | null;
}

interface TranscriptRow extends RowDataPacket {
  id: string;
  meeting_id: string;
  ts_secs: number;
  speaker: string;
  text: string;
  position: number;
}

interface ActionRow extends RowDataPacket {
  id: string;
  meeting_id: string;
  title: string;
  owner: string | null;
  due_date: string | null;
  done: number;
  position: number;
}

interface DecisionRow extends RowDataPacket {
  id: string;
  meeting_id: string;
  title: string;
  position: number;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/** Parse a JSON string[] column that may arrive as a string (driver quirks) or already-parsed array. */
function parseStringArray(raw: string | unknown[] | null): string[] {
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

/** Parse the ctx_updates JSON column into well-formed MeetingCtxUpdate rows. */
function parseCtxUpdates(raw: string | unknown[] | null): MeetingCtxUpdate[] {
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
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .filter((u) => typeof u.who === 'string' && typeof u.change === 'string' && typeof u.delta === 'string')
    .map((u) => ({ who: u.who as string, change: u.change as string, delta: u.delta as string }));
}

/** Parse the artifacts JSON column into well-formed MeetingArtifact rows. */
function parseArtifacts(raw: string | unknown[] | null): MeetingArtifact[] {
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

function toTranscriptLine(r: TranscriptRow): MeetingTranscriptLine {
  return { tsLabel: mmss(r.ts_secs), speaker: r.speaker, text: r.text };
}
function toActionRow(r: ActionRow): MeetingActionRow {
  return {
    id: r.id,
    title: r.title,
    ownerMeta: `Owner ${r.owner ?? '—'}`,
    dueLabel: r.done === 1 ? null : r.due_date ? dateLabel(r.due_date) : null,
    done: r.done === 1,
  };
}
function toDecisionRow(r: DecisionRow): MeetingDecisionRow {
  return { id: r.id, title: r.title };
}

interface Children {
  transcripts: TranscriptRow[];
  actions: ActionRow[];
  decisions: DecisionRow[];
}

function toMeeting(m: MeetingRow, c: Children): Meeting {
  const fromRecorder = m.source === 'recorder';
  const isNew = fromRecorder && isTodayDate(m.started_at);
  return {
    id: m.id,
    title: m.title,
    mode: m.mode,
    isNew,
    dowLabel: weekdayUpperOf(m.started_at),
    dayNum: dayOfMonth(m.started_at),
    dateLabel: dateLabel(m.started_at),
    timeLabel: timeOfDayLabel(m.started_at),
    durationLabel: fromRecorder ? mmss(m.duration_secs) : `${Math.round(m.duration_secs / 60)} min`,
    sentiment: m.sentiment,
    summary: m.summary ?? '',
    topics: parseStringArray(m.topics),
    participants: parseStringArray(m.participants),
    risks: parseStringArray(m.risks),
    followups: parseStringArray(m.followups),
    actions: c.actions.map(toActionRow),
    decisions: c.decisions.map(toDecisionRow),
    transcript: c.transcripts.map(toTranscriptLine),
    ctxUpdates: parseCtxUpdates(m.ctx_updates),
    linkNote: m.link_note ?? '',
    artifacts: parseArtifacts(m.artifacts),
    carryovers: parseStringArray(m.carryovers),
    sttEngine: m.stt_engine ?? null,
  };
}

/** Escapes LIKE wildcards in user input so they are matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** First sentence of a summary, hard-capped (feeds the previous-meetings context block). */
function firstSentence(text: string, max = 180): string {
  const trimmed = text.trim();
  const period = trimmed.indexOf('. ');
  const sentence = period > 0 ? trimmed.slice(0, period + 1) : trimmed;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

// ── Write input ─────────────────────────────────────────────────────────────

/** Everything needed to persist one processed meeting with its children. */
export interface CreateProcessedInput {
  title: string;
  mode: MeetingMode;
  /** "YYYY-MM-DD HH:MM:SS" in the design frame. */
  startedAt: string;
  durationSecs: number;
  sentiment: MeetingSentiment;
  summary: string;
  topics: string[];
  participants: string[];
  risks: string[];
  followups: string[];
  ctxUpdates: MeetingCtxUpdate[];
  linkNote: string;
  /** Docs/repos/tickets/links extracted from the transcript. */
  artifacts: MeetingArtifact[];
  /** Items carried over from previous meetings. */
  carryovers: string[];
  /** "whisper-large-v3" | "browser-speech" | null (legacy/seed). */
  sttEngine: string | null;
  source: 'seed' | 'recorder';
  /** Defaults to 'processed'. */
  status?: string;
  /** Natural key — when set, an earlier meeting with the same key is replaced. */
  demoKey?: string | null;
  transcript: { tsSecs: number; speaker: string; text: string }[];
  actions: { title: string; owner: string | null; dueDate: string | null; done?: boolean }[];
  decisions: string[];
}

// ── Repository ──────────────────────────────────────────────────────────────

export const meetingsRepo = {
  /** Returns the raw meeting row IF it belongs to the tenant, else null. */
  async findRow(tenantId: string, meetingId: string): Promise<MeetingRow | null> {
    const rows = await query<MeetingRow[]>('SELECT * FROM meetings WHERE id = :id AND tenant_id = :t', {
      id: meetingId,
      t: tenantId,
    });
    return rows[0] ?? null;
  },

  /** Hydrates a single meeting (transcript, actions, decisions). Null if not in tenant. */
  async getById(tenantId: string, meetingId: string): Promise<Meeting | null> {
    const row = await this.findRow(tenantId, meetingId);
    if (!row) return null;
    const [transcripts, actions, decisions] = await Promise.all([
      query<TranscriptRow[]>('SELECT * FROM meeting_transcripts WHERE meeting_id = :mid ORDER BY position, id', { mid: meetingId }),
      query<ActionRow[]>('SELECT * FROM meeting_actions WHERE meeting_id = :mid ORDER BY position, id', { mid: meetingId }),
      query<DecisionRow[]>('SELECT * FROM meeting_decisions WHERE meeting_id = :mid ORDER BY position, id', { mid: meetingId }),
    ]);
    return toMeeting(row, { transcripts, actions, decisions });
  },

  /**
   * Lists the tenant's meetings, fully hydrated, newest first. An optional
   * keyword filters case-insensitively across title, summary and the JSON
   * text of topics + participants.
   */
  async listByTenant(tenantId: string, q?: string): Promise<Meeting[]> {
    const params: Record<string, unknown> = { t: tenantId };
    let sql = 'SELECT * FROM meetings WHERE tenant_id = :t';
    const keyword = q?.trim();
    if (keyword) {
      // TODO: replace with embedding search via the context retriever.
      sql +=
        ` AND (LOWER(title) LIKE :kw OR LOWER(COALESCE(summary, '')) LIKE :kw` +
        ` OR LOWER(COALESCE(CAST(topics AS CHAR), '')) LIKE :kw` +
        ` OR LOWER(COALESCE(CAST(participants AS CHAR), '')) LIKE :kw)`;
      params.kw = `%${escapeLike(keyword.toLowerCase())}%`;
    }
    sql += ' ORDER BY started_at DESC, created_at DESC';
    const meetings = await query<MeetingRow[]>(sql, params);
    if (meetings.length === 0) return [];

    const ids = meetings.map((m) => m.id);
    const placeholders = ids.map((_, i) => `:m${i}`).join(', ');
    const childParams: Record<string, unknown> = {};
    ids.forEach((mid, i) => {
      childParams[`m${i}`] = mid;
    });

    // Batch-load all children for this tenant's meetings in one round-trip each.
    const [transcripts, actions, decisions] = await Promise.all([
      query<TranscriptRow[]>(`SELECT * FROM meeting_transcripts WHERE meeting_id IN (${placeholders}) ORDER BY position, id`, childParams),
      query<ActionRow[]>(`SELECT * FROM meeting_actions WHERE meeting_id IN (${placeholders}) ORDER BY position, id`, childParams),
      query<DecisionRow[]>(`SELECT * FROM meeting_decisions WHERE meeting_id IN (${placeholders}) ORDER BY position, id`, childParams),
    ]);

    const byMeeting = <R extends { meeting_id: string }>(rows: R[]): Map<string, R[]> => {
      const m = new Map<string, R[]>();
      for (const r of rows) {
        const list = m.get(r.meeting_id);
        if (list) list.push(r);
        else m.set(r.meeting_id, [r]);
      }
      return m;
    };
    const transcriptsMap = byMeeting(transcripts);
    const actionsMap = byMeeting(actions);
    const decisionsMap = byMeeting(decisions);

    return meetings.map((m) =>
      toMeeting(m, {
        transcripts: transcriptsMap.get(m.id) ?? [],
        actions: actionsMap.get(m.id) ?? [],
        decisions: decisionsMap.get(m.id) ?? [],
      }),
    );
  },

  /**
   * A compact formatted block of the tenant's most recent meetings — one line
   * per meeting with its date, title, summary opener, open actions and
   * decisions. Feeds carryover extraction; null when no meetings exist yet.
   */
  async recentContext(tenantId: string, limit = 8): Promise<string | null> {
    const cap = Math.max(1, Math.min(20, Math.floor(limit)));
    const meetings = await query<RecentMeetingRow[]>(
      `SELECT id, title, started_at, summary FROM meetings
        WHERE tenant_id = :t
        ORDER BY started_at DESC, created_at DESC
        LIMIT ${cap}`,
      { t: tenantId },
    );
    if (meetings.length === 0) return null;

    const placeholders = meetings.map((_, i) => `:m${i}`).join(', ');
    const childParams: Record<string, unknown> = {};
    meetings.forEach((m, i) => {
      childParams[`m${i}`] = m.id;
    });
    const [openActions, decisions] = await Promise.all([
      query<ActionRow[]>(
        `SELECT * FROM meeting_actions WHERE meeting_id IN (${placeholders}) AND done = 0 ORDER BY position, id`,
        childParams,
      ),
      query<DecisionRow[]>(
        `SELECT * FROM meeting_decisions WHERE meeting_id IN (${placeholders}) ORDER BY position, id`,
        childParams,
      ),
    ]);
    const actionsByMeeting = new Map<string, string[]>();
    for (const a of openActions) {
      const list = actionsByMeeting.get(a.meeting_id);
      if (list) list.push(a.title);
      else actionsByMeeting.set(a.meeting_id, [a.title]);
    }
    const decisionsByMeeting = new Map<string, string[]>();
    for (const d of decisions) {
      const list = decisionsByMeeting.get(d.meeting_id);
      if (list) list.push(d.title);
      else decisionsByMeeting.set(d.meeting_id, [d.title]);
    }

    return meetings
      .map((m) => {
        let line = `- ${dateLabel(m.started_at)} "${m.title}": ${firstSentence(m.summary ?? '')}`;
        const open = actionsByMeeting.get(m.id) ?? [];
        if (open.length) line += `; open: ${open.slice(0, 4).join(', ')}`;
        const decided = decisionsByMeeting.get(m.id) ?? [];
        if (decided.length) line += `; decided: ${decided.slice(0, 4).join(', ')}`;
        return line;
      })
      .join('\n');
  },

  /**
   * Persists one processed meeting with its transcript, actions and decisions
   * in a single transaction. When `demoKey` is set, the tenant's earlier
   * meeting with that key is deleted first (children + engagement events
   * cascade), so re-recording the demo replaces instead of stacking.
   */
  /** Deletes a meeting note (transcript, actions, decisions and engagement events cascade). */
  async remove(tenantId: string, meetingId: string): Promise<boolean> {
    const result = await execute('DELETE FROM meetings WHERE id = :mid AND tenant_id = :tid', {
      mid: meetingId,
      tid: tenantId,
    });
    return result.affectedRows > 0;
  },

  async createProcessed(tenantId: string, data: CreateProcessedInput): Promise<Meeting> {
    const meetingId = id('mtg');
    await withTransaction(async (conn) => {
      if (data.demoKey) {
        await conn.execute('DELETE FROM meetings WHERE tenant_id = :t AND demo_key = :k', {
          t: tenantId,
          k: data.demoKey,
        } as never);
      }
      await conn.execute(
        `INSERT INTO meetings
           (id, tenant_id, title, mode, started_at, duration_secs, sentiment, summary, topics, participants,
            risks, followups, ctx_updates, artifacts, carryovers, link_note, source, stt_engine, demo_key, status)
         VALUES
           (:id, :t, :title, :mode, :start, :dur, :sentiment, :summary, :topics, :participants,
            :risks, :followups, :ctx, :artifacts, :carryovers, :link, :source, :sttEngine, :demoKey, :status)`,
        {
          id: meetingId,
          t: tenantId,
          title: data.title.slice(0, 255),
          mode: data.mode,
          start: data.startedAt,
          dur: data.durationSecs,
          sentiment: data.sentiment,
          summary: data.summary,
          topics: JSON.stringify(data.topics),
          participants: JSON.stringify(data.participants),
          risks: JSON.stringify(data.risks),
          followups: JSON.stringify(data.followups),
          ctx: JSON.stringify(data.ctxUpdates),
          artifacts: JSON.stringify(data.artifacts),
          carryovers: JSON.stringify(data.carryovers),
          link: data.linkNote.slice(0, 255),
          source: data.source,
          sttEngine: data.sttEngine ? data.sttEngine.slice(0, 40) : null,
          demoKey: data.demoKey ?? null,
          status: data.status ?? 'processed',
        } as never,
      );
      // Children go in as one multi-row INSERT per table — a recording can carry
      // hundreds of transcript lines, and per-row round-trips would hold the
      // transaction (and its locks) open for the whole exchange.
      const bulkInsert = async (insertHead: string, rows: unknown[][]): Promise<void> => {
        if (!rows.length) return;
        const params: Record<string, unknown> = {};
        const tuples = rows.map(
          (row, i) =>
            `(${row
              .map((value, j) => {
                params[`v${i}_${j}`] = value;
                return `:v${i}_${j}`;
              })
              .join(', ')})`,
        );
        await conn.execute(`${insertHead} VALUES ${tuples.join(', ')}`, params as never);
      };

      await bulkInsert(
        'INSERT INTO meeting_transcripts (id, meeting_id, ts_secs, speaker, text, position)',
        data.transcript.map((line, i) => [id('mtr'), meetingId, line.tsSecs, line.speaker.slice(0, 80), line.text, i]),
      );
      await bulkInsert(
        'INSERT INTO meeting_actions (id, meeting_id, title, owner, due_date, done, position)',
        data.actions.map((action, i) => [
          id('mact'),
          meetingId,
          action.title.slice(0, 255),
          action.owner ? action.owner.slice(0, 80) : null,
          action.dueDate ?? null,
          action.done ? 1 : 0,
          i,
        ]),
      );
      await bulkInsert(
        'INSERT INTO meeting_decisions (id, meeting_id, title, position)',
        data.decisions.map((title, i) => [id('mdec'), meetingId, title.slice(0, 255), i]),
      );
    });
    const created = await this.getById(tenantId, meetingId);
    if (!created) throw new Error('Failed to create meeting');
    return created;
  },

  /**
   * Upserts one engagement event per boosted participant for a meeting.
   * unique(person_id, meeting_id) makes reprocessing update the existing row
   * (delta/date/title) instead of stacking a second boost.
   */
  async replaceEngagementEvents(
    tenantId: string,
    meetingId: string,
    boosts: { personId: string; delta: number; title: string }[],
  ): Promise<void> {
    if (!boosts.length) return;
    const occurredOn = todayDate();
    const params: Record<string, unknown> = {};
    const tuples = boosts.map((boost, i) => {
      params[`id${i}`] = id('engev');
      params[`t${i}`] = tenantId;
      params[`p${i}`] = boost.personId;
      params[`m${i}`] = meetingId;
      params[`d${i}`] = boost.delta;
      params[`on${i}`] = occurredOn;
      params[`ti${i}`] = boost.title.slice(0, 255);
      return `(:id${i}, :t${i}, :p${i}, :m${i}, :d${i}, :on${i}, :ti${i})`;
    });
    // created_at is refreshed on upsert so "latest boosting meeting" (which
    // orders by created_at) reflects the most recent processing, not the first.
    await execute(
      `INSERT INTO engagement_events (id, tenant_id, person_id, meeting_id, delta, occurred_on, title)
       VALUES ${tuples.join(', ')}
       ON DUPLICATE KEY UPDATE delta = VALUES(delta), occurred_on = VALUES(occurred_on), title = VALUES(title),
         created_at = CURRENT_TIMESTAMP`,
      params,
    );
  },
};
