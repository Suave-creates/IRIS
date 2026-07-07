import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { MEETING_MODES } from '@iris/shared';
import type {
  EngagementBoost,
  LiveMeeting,
  MeetingMode,
  ProcessedMeeting,
  RecordingTranscriptLine,
  SessionUser,
} from '@iris/shared';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { id } from '../../lib/ids.js';
import { execute, query } from '../../db/pool.js';
import { dateLabel, nowDateTime, todayDate } from '../../lib/design-frame.js';
import { mysqlUtcToIso } from '../../lib/datetime.js';
import { calendarRepo } from '../calendar/calendar.repo.js';
import { getEventAttendees } from '../../connectors/google/calendar.js';
import { meetingsRepo } from './meetings.repo.js';
import { extractMeeting } from './meetings.ai.js';
import { mapPreviewSpeaker, mergeChannelSegments, transcribeAudio } from './stt.js';
import { transcribeWithGemini } from './gemini.js';

const listQuerySchema = z.object({ q: z.string().trim().max(200).optional() });
const idParams = z.object({ id: z.string().min(1) });

const transcriptLineSchema = z.object({
  tsSecs: z.number().int().min(0),
  speaker: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(2000),
});

const attendeeNamesSchema = z.array(z.string().trim().min(1).max(120)).max(50);

const recordingSchema = z.object({
  mode: z.enum(MEETING_MODES),
  durationSecs: z.number().int().min(0).max(86400),
  transcript: z.array(transcriptLineSchema).min(1).max(500),
  titleHint: z.string().trim().max(255).nullish(),
  attendeeNames: attendeeNamesSchema.optional(),
});

/** Non-file fields of the multipart POST /audio body (all arrive as strings). */
const audioFieldsSchema = z.object({
  mode: z.enum(MEETING_MODES),
  durationSecs: z.coerce.number().int().min(0).max(86400),
  titleHint: z.string().trim().max(255).optional(),
  language: z.string().trim().max(16).optional(),
  calendarEventId: z.string().trim().max(64).optional(),
  /** JSON array of participant names (calendar attendees / extension-scraped). */
  attendeeNames: z.string().max(8000).optional(),
  preview: z.string().max(2_000_000).optional(),
});

/** The browser's live preview transcript, used when Whisper fails. */
const previewLinesSchema = z.array(transcriptLineSchema).max(500);

interface PersonMatchRow extends RowDataPacket {
  id: string;
  name: string;
  email: string | null;
}

interface LiveEventRow extends RowDataPacket {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  attendees: number;
  google_event_id: string | null;
}

interface CalendarEventLookupRow extends RowDataPacket {
  id: string;
  title: string;
  google_event_id: string | null;
}

const MEETING_EVENT_COLOR = '#4b49d6';

/** Whisper can emit far more lines than the browser preview; keep the prompt and DB bounded. */
const MAX_TRANSCRIPT_LINES = 1200;

/** UTC MySQL DATETIME for the calendar module (which stores UTC). */
function utcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Streams one multipart file part to a temp file, recording it for cleanup. */
async function saveUploadToTemp(part: MultipartFile, tempPaths: string[]): Promise<string> {
  const rawExt = extname(part.filename ?? '').toLowerCase();
  const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.webm';
  const path = join(tmpdir(), `iris-rec-${randomUUID()}${ext}`);
  tempPaths.push(path);
  await pipeline(part.file, createWriteStream(path));
  return path;
}

// ── Core recording pipeline (shared by POST / and POST /audio) ───────────────

interface ProcessRecordingInput {
  mode: MeetingMode;
  durationSecs: number;
  transcript: RecordingTranscriptLine[];
  titleHint: string | null;
  /** Candidate identities from the linked calendar event's live attendee list. */
  attendeeNames: string[];
  /** "whisper-large-v3" | "browser-speech" | null. */
  sttEngine: string | null;
}

/**
 * Finalizes one recording: extraction → speaker attribution → persistence
 * (artifacts, carryovers, STT engine included) → people matching + engagement
 * boosts → calendar mirror → context memories.
 */
async function processRecording(me: SessionUser, input: ProcessRecordingInput): Promise<ProcessedMeeting> {
  const finishedAt = new Date();

  // 1. Real AI extraction over the transcript, grounded by the calendar
  //    attendee candidates and the previous-meetings context (carryovers).
  const speakers = [...new Set(input.transcript.map((l) => l.speaker))];
  const previousContext = await meetingsRepo.recentContext(me.tenantId);
  const content = await extractMeeting({
    mode: input.mode,
    transcript: input.transcript,
    speakers,
    titleHint: input.titleHint,
    userName: me.name,
    attendeeNames: input.attendeeNames,
    previousContext,
  });
  // Participants come from the extraction (real people the AI heard about) —
  // normalizeMeeting has already stripped channel labels and placeholders.
  const participants = content.participants;

  // Apply the AI's per-line speaker attribution; unattributed lines keep the
  // channel identity they arrived with (the executive's name / "Unknown Speaker").
  const attributed = new Map(content.attribution.map((a) => [a.line, a.speaker]));
  const transcript = input.transcript.map((line, i) => {
    const speaker = attributed.get(i);
    return speaker ? { ...line, speaker: speaker.slice(0, 80) } : line;
  });

  // 2. Persist the meeting + children, stamped with the recording's real
  //    start time (finalize time minus duration, local wall clock).
  const startedDate = new Date(finishedAt.getTime() - input.durationSecs * 1000);
  const meeting = await meetingsRepo.createProcessed(me.tenantId, {
    title: content.title,
    mode: input.mode,
    startedAt: nowDateTime(startedDate),
    durationSecs: input.durationSecs,
    sentiment: content.sentiment,
    summary: content.summary,
    topics: content.topics,
    participants,
    risks: content.risks,
    followups: content.followups,
    ctxUpdates: content.ctxUpdates.map((u) => ({
      who: u.who,
      change: u.change,
      delta: u.delta ?? `Engagement +${u.deltaN}`,
    })),
    linkNote: content.linkNote,
    artifacts: content.artifacts,
    carryovers: content.carryovers,
    sttEngine: input.sttEngine,
    source: 'recorder',
    status: 'processed',
    demoKey: null,
    transcript,
    actions: content.actions.map((a) => ({ title: a.title, owner: a.owner, dueDate: a.dueDate, done: false })),
    decisions: content.decisions,
  });

  // 3. Match ctx-update names (and extracted participants) to People rows —
  //    case-insensitive full-name match, then unambiguous first-name match
  //    (speech usually carries short names), then email (calendar attendees
  //    often arrive as bare addresses). The executive is never boosted.
  const people = await query<PersonMatchRow[]>('SELECT id, name, email FROM people WHERE tenant_id = :t', {
    t: me.tenantId,
  });
  const peopleByName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p]));
  const peopleByEmail = new Map<string, PersonMatchRow>();
  for (const p of people) {
    const email = p.email?.trim().toLowerCase();
    if (email && !peopleByEmail.has(email)) peopleByEmail.set(email, p);
  }
  const peopleByFirstName = new Map<string, PersonMatchRow | null>();
  for (const p of people) {
    const first = p.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) continue;
    // Two roster people sharing a first name → ambiguous → no first-name match.
    peopleByFirstName.set(first, peopleByFirstName.has(first) ? null : p);
  }
  const resolvePerson = (name: string): PersonMatchRow | null => {
    const key = name.trim().toLowerCase();
    if (key.includes('@')) return peopleByEmail.get(key) ?? null;
    return peopleByName.get(key) ?? peopleByFirstName.get(key) ?? null;
  };

  const selfKey = me.name.trim().toLowerCase();
  const deltaByName = new Map<string, number>();
  for (const u of content.ctxUpdates) {
    const key = u.who.trim().toLowerCase();
    if (key === 'you' || key === selfKey || deltaByName.has(key)) continue;
    deltaByName.set(key, u.deltaN);
  }
  for (const name of participants) {
    const key = name.trim().toLowerCase();
    if (key === 'you' || key === selfKey || deltaByName.has(key)) continue;
    deltaByName.set(key, 2);
  }
  const boosts: EngagementBoost[] = [];
  const boosted = new Set<string>();
  for (const [key, delta] of deltaByName) {
    const person = resolvePerson(key);
    if (person && !boosted.has(person.id)) {
      boosted.add(person.id);
      boosts.push({ personId: person.id, name: person.name, delta });
    }
  }

  // 4. Upsert engagement events (re-processing a meeting replaces, never stacks).
  await meetingsRepo.replaceEngagementEvents(
    me.tenantId,
    meeting.id,
    boosts.map((b) => ({ personId: b.personId, delta: b.delta, title: content.title })),
  );

  // 5. Mirror the meeting onto the calendar at its real time — non-fatal.
  let calendarEventId: string | null = null;
  try {
    const event = await calendarRepo.create({
      tenantId: me.tenantId,
      userId: me.id,
      title: content.title,
      startAt: utcDateTime(startedDate),
      endAt: utcDateTime(finishedAt),
      color: MEETING_EVENT_COLOR,
      source: 'meetings',
      attendees: participants.length,
      notes: content.summary,
    });
    calendarEventId = event.id;
  } catch (err) {
    logger.warn({ err, meetingId: meeting.id }, 'calendar event creation failed for processed meeting');
  }

  // 6. Write one context memory per matched participant.
  for (const u of content.ctxUpdates) {
    const person = resolvePerson(u.who);
    if (!person) continue;
    await execute(
      `INSERT INTO memories (id, tenant_id, type, content, source, scope)
       VALUES (:id, :t, 'contact', :content, :source, 'long')`,
      {
        id: id('mem'),
        t: me.tenantId,
        content: `${u.who}: ${u.change}`.slice(0, 500),
        source: `meeting · ${content.title}`.slice(0, 200),
      },
    );
  }

  logger.info(
    {
      meetingId: meeting.id,
      boosts: boosts.length,
      calendarEventId,
      lines: input.transcript.length,
      sttEngine: input.sttEngine,
    },
    'recording processed into a meeting',
  );

  return {
    meeting,
    engagement: boosts,
    calendarDateLabel: dateLabel(todayDate()),
    openActionCount: meeting.actions.filter((a) => !a.done).length,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function meetingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── List + natural-language search ────────────────────────────────────────
  app.get('/', async (req) => {
    const me = currentUser(req);
    const { q } = listQuerySchema.parse(req.query);
    return { data: await meetingsRepo.listByTenant(me.tenantId, q) };
  });

  // ── Meeting detection: calendar events happening right now ────────────────
  // (Synced from Google Calendar via the connectors; own meeting mirrors are
  // excluded so a processed recording never "detects" itself.)
  app.get('/live', async (req) => {
    const me = currentUser(req);
    const now = new Date();
    const soon = new Date(now.getTime() + 5 * 60_000);
    const rows = await query<LiveEventRow[]>(
      `SELECT id, title, start_at, end_at, location, attendees, google_event_id
         FROM calendar_events
        WHERE tenant_id = :t AND source <> 'meetings'
          AND start_at <= :soon AND end_at >= :now
        ORDER BY start_at
        LIMIT 5`,
      { t: me.tenantId, now: utcDateTime(now), soon: utcDateTime(soon) },
    );
    const data: LiveMeeting[] = await Promise.all(
      rows.map(async (r) => {
        // Live attendee names from Google (best effort — [] when not linked).
        const attendees = r.google_event_id ? await getEventAttendees(me.tenantId, r.google_event_id) : [];
        return {
          id: r.id,
          title: r.title,
          startAt: mysqlUtcToIso(r.start_at),
          endAt: mysqlUtcToIso(r.end_at),
          location: r.location ?? null,
          attendees: r.attendees,
          attendeeNames: attendees.map((a) => a.name ?? a.email),
          googleEventId: r.google_event_id ?? null,
        };
      }),
    );
    return { data };
  });

  app.get('/:id', async (req) => {
    const me = currentUser(req);
    const { id: meetingId } = idParams.parse(req.params);
    const meeting = await meetingsRepo.getById(me.tenantId, meetingId);
    if (!meeting) throw Errors.notFound('Meeting not found.');
    return { data: meeting };
  });

  // ── Delete a meeting note (children + engagement events cascade) ──────────
  app.delete('/:id', async (req) => {
    const me = currentUser(req);
    const { id: meetingId } = idParams.parse(req.params);
    const meeting = await meetingsRepo.getById(me.tenantId, meetingId);
    if (!meeting) throw Errors.notFound('Meeting not found.');
    await meetingsRepo.remove(me.tenantId, meetingId);
    // Take the meeting's mirrors with it (best effort — the note is gone regardless).
    try {
      await execute(
        `DELETE FROM calendar_events WHERE tenant_id = :t AND source = 'meetings' AND title = :title`,
        { t: me.tenantId, title: meeting.title },
      );
      await execute(`DELETE FROM memories WHERE tenant_id = :t AND source = :src`, {
        t: me.tenantId,
        src: `meeting · ${meeting.title}`.slice(0, 200),
      });
    } catch (err) {
      logger.warn({ err, meetingId }, 'meeting mirror cleanup failed');
    }
    logger.info({ meetingId, tenantId: me.tenantId }, 'meeting note deleted');
    return { data: { ok: true } };
  });

  // ── Finalize a browser-transcribed recording (JSON) ────────────────────────
  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = recordingSchema.parse(req.body);
    const data = await processRecording(me, {
      mode: body.mode,
      durationSecs: body.durationSecs,
      transcript: body.transcript,
      titleHint: body.titleHint ?? null,
      attendeeNames: body.attendeeNames ?? [],
      sttEngine: 'browser-speech',
    });
    return { data };
  });

  // ── Finalize an audio recording (multipart): Whisper → extraction ─────────
  // FormData contract (the web recorder depends on these exact names):
  // files 'mic' (required) + 'call' (optional); fields mode, durationSecs,
  // titleHint, language, calendarEventId, preview (JSON RecordingTranscriptLine[]).
  app.post('/audio', async (req) => {
    const me = currentUser(req);

    const tempPaths: string[] = [];
    const saveFile = async (part: MultipartFile): Promise<string> => {
      const rawExt = extname(part.filename ?? '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.webm';
      const path = join(tmpdir(), `iris-rec-${randomUUID()}${ext}`);
      tempPaths.push(path);
      await pipeline(part.file, createWriteStream(path));
      return path;
    };

    try {
      let micPath: string | null = null;
      let callPath: string | null = null;
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'mic') micPath = await saveFile(part);
          else if (part.fieldname === 'call') callPath = await saveFile(part);
          else part.file.resume(); // drain unknown file parts
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
      if (!micPath) throw Errors.validation('The mic audio file is required.');
      const body = audioFieldsSchema.parse(fields);

      // Browser live-preview lines — the fallback when Whisper fails.
      let previewLines: RecordingTranscriptLine[] = [];
      if (body.preview) {
        try {
          previewLines = previewLinesSchema.parse(JSON.parse(body.preview));
        } catch (err) {
          logger.warn({ err }, 'unparseable preview transcript on /audio — ignoring');
        }
      }

      // Transcribe both channels concurrently (Gemini calls are network-bound,
      // so this roughly halves latency when call audio is connected). Gemini
      // when configured, else local Whisper. The call channel only counts when
      // the mic channel transcribed too.
      const language = body.language ?? null;
      const [micResult, callResultRaw] = await Promise.all([
        transcribeAudio(micPath, language),
        callPath ? transcribeAudio(callPath, language) : Promise.resolve(null),
      ]);
      const callResult = micResult ? callResultRaw : null;

      let transcript: RecordingTranscriptLine[] = [];
      let sttEngine = 'browser-speech';
      if (micResult) {
        transcript = mergeChannelSegments(me.name, micResult.segments, callResult?.segments ?? []);
        sttEngine = micResult.engine;
      }
      if (transcript.length === 0) {
        // Both server engines produced nothing — fall back to the (flaky) browser
        // preview. Loud on purpose: this is the usual cause of a bad transcript.
        logger.warn(
          { hadMicAudio: Boolean(micResult), previewLines: previewLines.length },
          'server STT (Gemini/Whisper) produced no transcript — using browser preview fallback. Check GEMINI_API_KEY + ffmpeg.',
        );
        transcript = previewLines.map((l) => ({ ...l, speaker: mapPreviewSpeaker(l.speaker, me.name) }));
        sttEngine = 'browser-speech';
      }
      transcript = transcript.slice(0, MAX_TRANSCRIPT_LINES);
      if (transcript.length === 0) {
        throw Errors.validation('No speech could be transcribed from the recording.');
      }

      // Attribution candidates: names the client already knows (calendar
      // attendees or extension-scraped participants) merged with the live Google
      // attendees of any linked event. De-duplicated case-insensitively.
      let titleHint = body.titleHint?.trim() || null;
      const nameByKey = new Map<string, string>();
      const addName = (raw: string | null | undefined): void => {
        const name = (raw ?? '').trim().slice(0, 120);
        if (name && !nameByKey.has(name.toLowerCase())) nameByKey.set(name.toLowerCase(), name);
      };
      if (body.attendeeNames) {
        try {
          const parsed = attendeeNamesSchema.parse(JSON.parse(body.attendeeNames));
          parsed.forEach(addName);
        } catch (err) {
          logger.warn({ err }, 'unparseable attendeeNames on /audio — ignoring');
        }
      }
      if (body.calendarEventId) {
        const rows = await query<CalendarEventLookupRow[]>(
          'SELECT id, title, google_event_id FROM calendar_events WHERE id = :id AND tenant_id = :t',
          { id: body.calendarEventId, t: me.tenantId },
        );
        const event = rows[0];
        if (event) {
          if (!titleHint) titleHint = event.title;
          if (event.google_event_id) {
            const attendees = await getEventAttendees(me.tenantId, event.google_event_id);
            attendees.forEach((a) => addName(a.name ?? a.email));
          }
        }
      }
      const attendeeNames = [...nameByKey.values()].slice(0, 50);

      const data = await processRecording(me, {
        mode: body.mode,
        durationSecs: body.durationSecs,
        transcript,
        titleHint,
        attendeeNames,
        sttEngine,
      });
      return { data };
    } finally {
      for (const path of tempPaths) {
        await unlink(path).catch(() => {
          /* already gone / locked — temp dir cleanup will get it */
        });
      }
    }
  });

  // ── Live near-real-time transcription of one short audio segment ───────────
  // Drives the recorder's live feed WHILE recording. Gemini only (fast); any
  // failure returns empty text so the live feed just skips an update — this
  // never blocks recording and never touches the final processed transcript.
  app.post('/transcribe-chunk', async (req) => {
    const tempPaths: string[] = [];
    try {
      let audioPath: string | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'audio' && !audioPath) audioPath = await saveUploadToTemp(part, tempPaths);
          else part.file.resume();
        }
      }
      if (!audioPath) return { data: { text: '' } };
      const result = await transcribeWithGemini(audioPath);
      const text = result ? result.segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim() : '';
      return { data: { text } };
    } catch (err) {
      logger.warn({ err }, 'live chunk transcription failed');
      return { data: { text: '' } };
    } finally {
      for (const path of tempPaths) await unlink(path).catch(() => undefined);
    }
  });
}
