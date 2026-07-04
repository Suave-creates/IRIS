import type Anthropic from '@anthropic-ai/sdk';
import type { MeetingMode, MeetingSentiment, RecordingTranscriptLine } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { mmss } from '../../lib/design-frame.js';
import { logger } from '../../lib/logger.js';

// ── Extraction result shape ─────────────────────────────────────────────────

export interface ExtractedAction {
  title: string;
  owner: string;
  /** "YYYY-MM-DD" when a clear due date exists, else null. */
  dueDate: string | null;
}

export interface ExtractedCtxUpdate {
  who: string;
  change: string;
  /** Engagement boost, clamped to 1..3. */
  deltaN: number;
  /** Display delta ("Engagement +1"); derived from deltaN when absent. */
  delta?: string;
}

/** A doc/repo/ticket/link genuinely referenced in the transcript. */
export interface ExtractedArtifact {
  /** Lowercase slug: url/github/jira/linear/gdoc/sheet/drive/figma/notion/confluence/doc/other. */
  kind: string;
  label: string;
  /** http(s) URL when one was actually stated, else null. */
  ref: string | null;
}

/** One transcript line attributed to a named speaker (sparse — only confident lines). */
export interface SpeakerAttribution {
  line: number;
  speaker: string;
}

/**
 * Everything IRIS distills from one recorded meeting. Real audio capture and
 * server-side Whisper only change where the transcript comes from — never
 * this contract.
 */
export interface ExtractedMeeting {
  title: string;
  summary: string;
  sentiment: MeetingSentiment;
  topics: string[];
  /** People taking part, inferred from the conversation itself (never capture-channel labels). */
  participants: string[];
  risks: string[];
  followups: string[];
  actions: ExtractedAction[];
  decisions: string[];
  ctxUpdates: ExtractedCtxUpdate[];
  linkNote: string;
  /** Per-line speaker attribution inferred from content ("Raj said…", replies, commitments). */
  attribution: SpeakerAttribution[];
  /** Docs/repos/tickets/links actually mentioned — empty when none were. */
  artifacts: ExtractedArtifact[];
  /** Items from previous meetings this one addressed or that remain open. */
  carryovers: string[];
}

/** Everything extractMeeting needs about one recording. */
export interface ExtractMeetingInput {
  mode: MeetingMode;
  transcript: RecordingTranscriptLine[];
  /** Distinct speaker labels present in the transcript. */
  speakers: string[];
  titleHint: string | null;
  /** The executive's real name — mic-channel lines carry it as speaker. */
  userName: string;
  /** Candidate identities from the calendar event's live attendee list. */
  attendeeNames: string[];
  /** Formatted block of recent meetings (feeds carryovers), or null. */
  previousContext: string | null;
}

// ── Channel-label hygiene ───────────────────────────────────────────────────

/** Capture-channel labels that must never be treated as people. */
const CHANNEL_LABELS = new Set(['you', 'mic', 'room', 'call', 'speaker', 'unknown', 'channel']);

/**
 * True for capture-channel / placeholder labels ("MIC", "CALL", "Speaker 1",
 * "mic channel") that must never surface as a person or a speaker name.
 */
export function isChannelLabel(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (CHANNEL_LABELS.has(key)) return true;
  // "Speaker 1", "SPK2", "Speaker A"
  if (/^(speaker|spk)[\s\-_.]*(\d+|[a-z])$/.test(key)) return true;
  // "Mic 2", "Call 1", "mic channel" — but never real names like "Mica".
  if (/^(mic|call|room)[\s\-_.]+(channel|\d+)$/.test(key)) return true;
  return false;
}

/**
 * True for the consistent "Unknown Speaker"/"Unknown Speaker A" placeholders —
 * valid as speaker-attribution targets, never as participants.
 */
export function isUnknownSpeakerLabel(name: string): boolean {
  return /^unknown\s+speaker(\s+[a-z0-9]{1,3})?$/i.test(name.trim());
}

// ── Tool schema ─────────────────────────────────────────────────────────────

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_meeting',
  description: 'Record the structured intelligence extracted from one meeting transcript.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Concise meeting title, e.g. "Online meeting — WH Automation sync"' },
      summary: {
        type: 'string',
        description:
          '2–4 crisp executive sentences citing only what was actually said (outcomes, numbers, commitments). Mention connections to previous meetings ONLY when the provided previous-meetings context genuinely supports them.',
      },
      sentiment: {
        type: 'string',
        enum: ['Positive', 'Mixed', 'Neutral'],
        description: '"Neutral" unless the discussion was clearly positive or clearly negative.',
      },
      topics: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short topic labels discussed' },
      participants: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Real full names of people taking part, inferred from the conversation (people addressed, people who commit to actions) and the calendar attendee list. Never capture labels (MIC, CALL, Speaker 1) and never "Unknown Speaker" placeholders.',
      },
      risks: { type: 'array', items: { type: 'string' }, description: 'Risks explicitly flagged in the meeting; empty if none' },
      followups: { type: 'array', items: { type: 'string' }, description: 'Follow-ups grounded in what was said; empty if none' },
      actions: {
        type: 'array',
        description: 'Every concrete commitment actually made, each with a single owner. Empty if none.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            owner: { type: 'string', description: 'Owner name as spoken in the meeting' },
            dueDate: { type: 'string', description: 'YYYY-MM-DD if a clear due date exists, else empty string' },
          },
          required: ['title', 'owner', 'dueDate'],
        },
      },
      decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions locked in the meeting; empty if none' },
      ctxUpdates: {
        type: 'array',
        description: 'One relationship/context change per named participant other than the executive',
        items: {
          type: 'object',
          properties: {
            who: { type: 'string', description: 'Participant name exactly as attributed in the transcript' },
            change: { type: 'string', description: 'Short description of what changed, e.g. "Projects +Index rebuild · 2 new open actions"' },
            deltaN: { type: 'integer', description: 'Engagement boost from 1 (minor) to 3 (major)' },
          },
          required: ['who', 'change', 'deltaN'],
        },
      },
      linkNote: { type: 'string', description: 'Comma-separated projects/programs this meeting links to' },
      artifacts: {
        type: 'array',
        description:
          'Docs, repos, tickets and links GENUINELY referenced in the transcript — a document someone named, a repo, a ticket id, a URL that was read out or shared. Empty array when none were mentioned. Never invent items.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              description: 'One of: url, github, jira, linear, gdoc, sheet, drive, figma, notion, confluence, doc, other',
            },
            label: { type: 'string', description: 'Short human label as referenced, e.g. "Q3 capacity sheet"' },
            ref: { type: 'string', description: 'The URL if one was actually stated, else empty string' },
          },
          required: ['kind', 'label', 'ref'],
        },
      },
      carryovers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Items from the previous-meetings context that this meeting addressed or that remain open. Empty when no previous context was provided or nothing in it relates to this meeting.',
      },
      speakerAttribution: {
        type: 'array',
        description:
          'Attribute numbered transcript lines to REAL speaker names ONLY where the words support it (self-introduction, being addressed, a reply, a commitment), preferring names from the calendar attendee list. When a distinct unidentified voice is discernible, use "Unknown Speaker A", "Unknown Speaker B" consistently. NEVER use labels like MIC, CALL or Speaker 1. Omit lines you are not confident about.',
        items: {
          type: 'object',
          properties: {
            line: { type: 'integer', description: 'The [n] index of the transcript line' },
            speaker: { type: 'string', description: 'The real name, or a consistent "Unknown Speaker A/B" placeholder' },
          },
          required: ['line', 'speaker'],
        },
      },
    },
    required: [
      'title',
      'summary',
      'sentiment',
      'topics',
      'participants',
      'risks',
      'followups',
      'actions',
      'decisions',
      'ctxUpdates',
      'linkNote',
      'artifacts',
      'carryovers',
      'speakerAttribution',
    ],
  },
};

// ── Normalization (never trust tool output) ─────────────────────────────────

const MAX_TOPICS = 5;
const MAX_LIST = 6;
const MAX_ACTIONS = 10;
const MAX_DECISIONS = 8;
const MAX_CTX_UPDATES = 10;
const MAX_ARTIFACTS = 12;
const MAX_CARRYOVERS = 8;

const VALID_SENTIMENT = new Set<MeetingSentiment>(['Positive', 'Mixed', 'Neutral']);

/** "2026-06-28" when the raw value parses as a date, else null. */
function normalizeDueDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  // Non-ISO forms parse as LOCAL midnight — read local date parts (not
  // toISOString, which shifts the calendar date east of UTC).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Clamps a raw engagement delta into 1..3, defaulting non-numbers to 2. */
function clampDeltaN(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 2;
  return Math.max(1, Math.min(3, n));
}

/** Keeps only non-empty strings, trimmed and bounded in count and length. */
function stringList(raw: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

/** Lowercase slug for an artifact kind ("Google Doc!" → "google-doc"), ≤20 chars. */
function normalizeArtifactKind(raw: unknown): string {
  const slug =
    typeof raw === 'string'
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 20)
      : '';
  return slug || 'other';
}

/** A valid-looking http(s) URL ≤500 chars, else null (empty string = no URL stated). */
function normalizeArtifactRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return null;
  return trimmed;
}

/** Sanitizes the raw artifacts array: label required, kind slugged, ref validated, capped. */
function normalizeArtifacts(raw: unknown): ExtractedArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => typeof a.label === 'string' && a.label.trim().length > 0)
    .map((a) => ({
      kind: normalizeArtifactKind(a.kind),
      label: String(a.label).trim().slice(0, 160),
      ref: normalizeArtifactRef(a.ref),
    }))
    .slice(0, MAX_ARTIFACTS);
}

/** Coerces one raw tool-emitted meeting object into a safe ExtractedMeeting. */
export function normalizeMeeting(raw: Record<string, unknown>, fallback: ExtractedMeeting): ExtractedMeeting {
  const topics = stringList(raw.topics, MAX_TOPICS, 60);
  const actions = Array.isArray(raw.actions)
    ? (raw.actions as { title?: unknown; owner?: unknown; dueDate?: unknown }[])
        .filter((a) => !!a && typeof a === 'object' && typeof a.title === 'string' && a.title.trim().length > 0)
        .map((a) => ({
          title: String(a.title).trim().slice(0, 255),
          owner: typeof a.owner === 'string' && a.owner.trim() ? a.owner.trim().slice(0, 80) : 'Unassigned',
          dueDate: normalizeDueDate(a.dueDate),
        }))
        .slice(0, MAX_ACTIONS)
    : [];
  const ctxUpdates = Array.isArray(raw.ctxUpdates)
    ? (raw.ctxUpdates as { who?: unknown; change?: unknown; deltaN?: unknown }[])
        .filter(
          (u) =>
            !!u &&
            typeof u === 'object' &&
            typeof u.who === 'string' &&
            u.who.trim().length > 0 &&
            typeof u.change === 'string' &&
            u.change.trim().length > 0,
        )
        .map((u) => ({
          who: String(u.who).trim().slice(0, 80),
          change: String(u.change).trim().slice(0, 255),
          deltaN: clampDeltaN(u.deltaN),
        }))
        .slice(0, MAX_CTX_UPDATES)
    : [];
  // Participants are real people only — never capture-channel labels, never
  // "Unknown Speaker" placeholders (those are attribution targets, not people).
  const participants = stringList(raw.participants, 12, 80).filter(
    (name) => !isChannelLabel(name) && !isUnknownSpeakerLabel(name),
  );
  const attribution = Array.isArray(raw.speakerAttribution)
    ? (raw.speakerAttribution as { line?: unknown; speaker?: unknown }[])
        .filter(
          (a) =>
            !!a &&
            typeof a === 'object' &&
            typeof a.line === 'number' &&
            Number.isInteger(a.line) &&
            a.line >= 0 &&
            typeof a.speaker === 'string' &&
            a.speaker.trim().length > 0,
        )
        .map((a) => ({ line: a.line as number, speaker: String(a.speaker).trim().slice(0, 80) }))
        // "Unknown Speaker A/B" is a legitimate attribution target; raw channel
        // labels (MIC, CALL, Speaker 1) never are.
        .filter((a) => !isChannelLabel(a.speaker))
        .slice(0, 500)
    : [];
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 255) : fallback.title,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim().slice(0, 2000) : fallback.summary,
    sentiment: VALID_SENTIMENT.has(raw.sentiment as MeetingSentiment) ? (raw.sentiment as MeetingSentiment) : 'Neutral',
    topics: topics.length ? topics : fallback.topics,
    participants: participants.length ? participants : fallback.participants,
    risks: stringList(raw.risks, MAX_LIST, 255),
    followups: stringList(raw.followups, MAX_LIST, 255),
    actions,
    decisions: stringList(raw.decisions, MAX_DECISIONS, 255),
    ctxUpdates: ctxUpdates.length ? ctxUpdates : fallback.ctxUpdates,
    linkNote: typeof raw.linkNote === 'string' && raw.linkNote.trim() ? raw.linkNote.trim().slice(0, 255) : fallback.linkNote,
    attribution,
    artifacts: normalizeArtifacts(raw.artifacts),
    carryovers: stringList(raw.carryovers, MAX_CARRYOVERS, 255),
  };
}

// ── Deterministic fallback ──────────────────────────────────────────────────

/**
 * Extraction used when no AI key is set or the AI call fails. Fully
 * deterministic: same transcript + participants → identical result. The
 * executive (`userName`) is a capture channel here, never a participant.
 */
export function buildFallbackMeeting(
  mode: MeetingMode,
  transcript: RecordingTranscriptLine[],
  speakers: string[],
  titleHint: string | null = null,
  userName: string | null = null,
): ExtractedMeeting {
  const firstText = transcript[0]?.text ?? '';
  const topic =
    firstText
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(' ') || 'Team';
  // Capture-channel labels, "Unknown Speaker" placeholders and the executive's
  // own name are not participants; without AI, participants can only come from
  // real remote speaker names, so this is usually empty.
  const selfKey = userName?.trim().toLowerCase() ?? null;
  const others = speakers.filter(
    (p) =>
      !isChannelLabel(p) && !isUnknownSpeakerLabel(p) && (selfKey === null || p.trim().toLowerCase() !== selfKey),
  );
  const joined = transcript
    .map((l) => l.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const summary = joined
    ? `Recorded ${mode === 'online' ? 'online' : 'in-room'} meeting${others.length ? ` with ${others.join(', ')}` : ''}. ${joined}`.slice(0, 400)
    : 'Recorded meeting captured without AI processing — transcript stored for later extraction.';
  return {
    title: titleHint?.trim() || `${mode === 'online' ? 'Online meeting' : 'In-room'} — ${topic}`,
    summary,
    sentiment: 'Neutral',
    topics: [topic],
    participants: others.map((who) => who.slice(0, 80)),
    risks: [],
    followups: [],
    actions: [],
    decisions: [],
    ctxUpdates: others.map((who) => ({
      who: who.slice(0, 80),
      change: 'Relationship summary refreshed · engagement tracked from this meeting',
      deltaN: 2,
    })),
    linkNote: topic,
    attribution: [],
    artifacts: [],
    carryovers: [],
  };
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Distills a recorded meeting transcript into structured intelligence using
 * Claude, falling back to a deterministic extraction on any failure.
 */
export async function extractMeeting(input: ExtractMeetingInput): Promise<ExtractedMeeting> {
  const { mode, transcript, speakers, titleHint, userName, attendeeNames, previousContext } = input;
  const fallback = buildFallbackMeeting(mode, transcript, speakers, titleHint, userName);
  if (!hasAnthropic || transcript.length === 0) return fallback;

  try {
    const lines = transcript.map((l, i) => `[${i}] [${mmss(l.tsSecs)}] ${l.speaker}: ${l.text}`).join('\n');
    const hintLine = titleHint?.trim()
      ? `This recording belongs to the calendar meeting "${titleHint.trim()}" — use that as the meeting title. `
      : '';
    const executive = userName.trim() || 'the executive';

    const persona =
      `You are IRIS, an executive chief-of-staff. Below is the transcript of a recorded ` +
      `${mode === 'online' ? 'online' : 'in-room'} meeting. Lines spoken by "${executive}" were captured ` +
      `from the executive's own microphone — that identity is certain. Lines labeled "Unknown Speaker" are ` +
      `the other side of the conversation; attribute them to REAL names only when the words support it ` +
      `(a self-introduction, being addressed by name, a reply, a commitment), preferring names from the ` +
      `calendar attendee list when one fits. When a distinct unidentified voice is discernible, label it ` +
      `"Unknown Speaker A", "Unknown Speaker B", … and use each label consistently. NEVER output ` +
      `capture-channel labels such as MIC, CALL or Speaker 1 anywhere in your answer. ` +
      `The speech may freely mix English and Hindi (romanized or Devanagari) — understand both, and write ` +
      `every extracted field in English. ${hintLine}` +
      `Call record_meeting exactly once with the meeting intelligence: a concise title, a 2–4 sentence ` +
      `executive summary, the overall sentiment, up to five short topics, the participants, explicitly ` +
      `flagged risks, suggested follow-ups, every concrete commitment as an action with its owner and due ` +
      `date, every decision locked, one context update per named participant with an engagement boost ` +
      `from 1 (minor) to 3 (major), the artifacts genuinely referenced, the carryovers from previous ` +
      `meetings, and speakerAttribution entries for the numbered lines whose speaker the content makes clear. ` +
      `HARD ANTI-HALLUCINATION RULES: every field must be grounded in the transcript; anything not ` +
      `discussed stays an empty list or is omitted; never invent names, dates, numbers, links or documents; ` +
      `the summary cites only what was said, and mentions connections to previous meetings ONLY when the ` +
      `previous-meetings context genuinely supports it; sentiment is "Neutral" unless the discussion was ` +
      `clearly positive or clearly negative.`;

    const contextParts: string[] = [];
    if (attendeeNames.length) {
      contextParts.push(
        `Calendar attendees of this meeting (candidate identities for unattributed speech):\n` +
          attendeeNames.map((n) => `- ${n}`).join('\n'),
      );
    }
    if (previousContext?.trim()) {
      contextParts.push(
        `Previous meetings (for carryovers and summary connections — use ONLY when this meeting genuinely relates):\n` +
          previousContext.trim(),
      );
    }

    const result = await extractWithTool<Record<string, unknown>>({
      system: systemBlocks(persona, contextParts.length ? contextParts.join('\n\n') : undefined),
      messages: [{ role: 'user', content: `Transcript:\n"""${lines}"""` }],
      tool: EXTRACT_TOOL,
      maxTokens: 4000,
    });

    if (!result || typeof result !== 'object') return fallback;
    const extracted = normalizeMeeting(result, fallback);
    // A linked calendar meeting names the note, whatever the model suggested.
    return titleHint?.trim() ? { ...extracted, title: titleHint.trim().slice(0, 255) } : extracted;
  } catch (err) {
    logger.warn({ err, mode, lines: transcript.length }, 'meeting extraction failed — using fallback');
    return fallback;
  }
}
