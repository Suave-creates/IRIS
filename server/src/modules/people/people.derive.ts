import type {
  EngagementStatus,
  EngagementTrend,
  PersonActionRow,
  PersonCalendarDay,
  PersonContext,
  PersonDayDetail,
  PersonEngagement,
  PersonFileRow,
  PersonInsightRow,
  PersonTimelineEntry,
  PersonTopicRow,
} from '@iris/shared';
import { freqLabel as sharedFreqLabel } from '@iris/shared';
import {
  agoLabel,
  dateLabel,
  dayOfMonth,
  isCurrentMonth,
  monthFrame,
  weekdayShortOf,
} from '../../lib/design-frame.js';

/**
 * Engagement derivation from REAL data only — nothing here is fabricated.
 * Inputs are exactly:
 *   - the person's user-entered plan (name, function, location, engagement days),
 *   - engagement_events written when a meeting is processed,
 *   - the processed meetings the person took part in (+ action items they own).
 * A person with no processed meetings gets a cadence-based baseline and honest
 * empty states everywhere else.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

/** The engagement_events fields the derivation reads (rows written by the meetings module). */
export interface EngagementEventLite {
  delta: number;
  /** MySQL DATE string ("2026-06-23"). */
  occurredOn: string;
  /** Display title of the boosting meeting ("WH Automation sync"). */
  title: string;
}

/** The person fields the derivation reads (structurally satisfied by Person and PersonInput). */
export interface PersonShape {
  name: string;
  func: string;
  location: string;
  days: number[];
}

/** A processed meeting the person participated in (read by people.repo). */
export interface PersonMeetingLite {
  id: string;
  title: string;
  /** MySQL DATETIME string. */
  startedAt: string;
  summary: string;
  topics: string[];
  /** 'seed' historically, 'recorder' for recordings. */
  source: string;
}

/** An extracted action item owned by the person (read by people.repo). */
export interface PersonActionLite {
  meetingId: string;
  meetingTitle: string;
  title: string;
  /** MySQL DATE string or null. */
  dueDate: string | null;
  done: boolean;
}

/** An artifact referenced in a meeting the person took part in (read by people.repo). */
export interface PersonArtifactLite {
  /** Lowercase slug: url/github/jira/gdoc/… */
  kind: string;
  label: string;
  /** http(s) URL when one was actually shared, else null. */
  ref: string | null;
  meetingTitle: string;
  /** MySQL DATETIME string. */
  startedAt: string;
}

// ── Core derivations ────────────────────────────────────────────────────────

/** Cadence label derived from the number of engagement days. */
export function freqLabel(days: number[]): string {
  return sharedFreqLabel(days.length);
}

/** Short Files-tab chip for a Drive MIME type (Docs/Sheets/Slides/PDF/…). */
export function driveKindChip(mimeType: string): string {
  const mime = mimeType.trim().toLowerCase();
  if (mime === 'application/vnd.google-apps.document') return 'DOC';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'SHT';
  if (mime === 'application/vnd.google-apps.presentation') return 'SLD';
  if (mime === 'application/vnd.google-apps.folder') return 'FLD';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'SHT';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'DOC';
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'SLD';
  if (mime.startsWith('image/')) return 'IMG';
  if (mime.startsWith('video/')) return 'VID';
  if (mime.startsWith('audio/')) return 'AUD';
  return 'FILE';
}

/**
 * Baseline score by planned cadence (index = engagement-day count). Documented,
 * deterministic, and identical for identical plans — no fabricated jitter.
 */
const CADENCE_BASE = [10, 32, 56, 72, 80, 88, 94] as const;

export function cadenceBaseScore(days: number[]): number {
  return CADENCE_BASE[Math.min(days.length, 6)] ?? 10;
}

/** Status label from the final score (same buckets the design's labels imply). */
export function statusLabelFor(score: number): EngagementStatus {
  if (score >= 85) return 'Highly Active';
  if (score >= 70) return 'Active';
  if (score >= 50) return 'Moderate';
  if (score >= 25) return 'Low Activity';
  return 'Dormant';
}

/** Sum of real meeting boosts. A stored delta of 0 counts as the default 2. */
function boostOf(events: EngagementEventLite[]): { total: number; latestTitle: string | null } {
  let total = 0;
  for (const event of events) total += event.delta || 2;
  const latest = events.length ? events[events.length - 1]! : null;
  return { total, latestTitle: latest ? latest.title : null };
}

/** The roster-list engagement payload — planned-cadence baseline + real meeting activity. */
export function deriveEngagement(days: number[], events: EngagementEventLite[], now: Date = new Date()): PersonEngagement {
  const { total, latestTitle } = boostOf(events);
  const score = Math.min(99, cadenceBaseScore(days) + total);
  const trend: EngagementTrend = total > 0 ? 'rising' : 'steady';
  const latest = events.length ? events[events.length - 1]! : null;
  return {
    score,
    statusLabel: statusLabelFor(score),
    trend,
    lastInteraction: latest ? agoLabel(latest.occurredOn, now) : null,
    meetingsThisMonth: events.filter((e) => isCurrentMonth(e.occurredOn, now)).length,
    boostDelta: total,
    boostTitle: latestTitle,
  };
}

// ── Drawer context (real aggregation) ───────────────────────────────────────

const TREND_WORD: Record<EngagementTrend, string> = { rising: 'rising', steady: 'steady', cooling: 'cooling' };

function firstSentence(text: string, max = 160): string {
  const trimmed = text.trim();
  const period = trimmed.indexOf('. ');
  const sentence = period > 0 ? trimmed.slice(0, period + 1) : trimmed;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** Frequency-ranked topics across the person's real meetings (top 5). */
function topicRows(meetings: PersonMeetingLite[]): PersonTopicRow[] {
  const counts = new Map<string, number>();
  for (const meeting of meetings) {
    for (const topic of meeting.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = ranked[0]?.[1] ?? 1;
  return ranked.map(([name, mentions]) => ({
    name,
    mentions,
    pct: Math.max(8, Math.round((mentions / max) * 100)),
  }));
}

function toActionRow(action: PersonActionLite): PersonActionRow {
  return {
    title: action.title,
    meta: `From ${action.meetingTitle}`,
    dueLabel: action.done || !action.dueDate ? null : dateLabel(action.dueDate),
    done: action.done,
  };
}

/** Short chip label per artifact kind ("url" → "URL", "github" → "GIT"). */
const KIND_CHIPS: Record<string, string> = {
  url: 'URL',
  github: 'GIT',
  jira: 'JIRA',
  linear: 'LIN',
  gdoc: 'DOC',
  sheet: 'SHT',
  drive: 'DRV',
  figma: 'FIG',
  notion: 'NOTE',
  confluence: 'CONF',
  doc: 'DOC',
  other: 'FILE',
};

/** Chip text for an artifact kind — mapped when known, else uppercased ≤4 chars. */
export function artifactKindChip(kind: string): string {
  const key = kind.trim().toLowerCase();
  return KIND_CHIPS[key] ?? (key.replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 4) || 'FILE');
}

/** Drawer Files rows from the person's meeting artifacts. */
function toFileRow(artifact: PersonArtifactLite): PersonFileRow {
  return {
    name: artifact.label,
    kind: artifactKindChip(artifact.kind),
    meta: `From ${artifact.meetingTitle} · ${dateLabel(artifact.startedAt)}`,
    ref: artifact.ref,
  };
}

/** Real-data insights; empty until the person has processed meetings. */
function insightRows(
  meetings: PersonMeetingLite[],
  actions: PersonActionLite[],
  topics: PersonTopicRow[],
): PersonInsightRow[] {
  const insights: PersonInsightRow[] = [];
  const top = topics[0];
  if (top && meetings.length > 1) {
    insights.push({
      kind: 'theme',
      title: 'Recurring theme',
      text: `"${top.name}" has come up in ${top.mentions} of the last ${meetings.length} meetings.`,
    });
  }
  const done = actions.filter((a) => a.done).length;
  if (actions.length > 0) {
    insights.push({
      kind: 'followthrough',
      title: 'Commitment follow-through',
      text: `${done} of ${actions.length} extracted action item${actions.length > 1 ? 's' : ''} closed so far.`,
    });
  }
  const nextDue = actions
    .filter((a) => !a.done && a.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0];
  if (nextDue) {
    insights.push({
      kind: 'nextstep',
      title: 'Suggested next step',
      text: `"${nextDue.title}" is due ${dateLabel(nextDue.dueDate!)} — worth a follow-up before then.`,
    });
  }
  return insights;
}

/**
 * The full drawer payload, aggregated from real data. Every list is empty (and
 * rendered as an empty state) until meetings involving this person exist.
 */
export function buildPersonContext(
  person: PersonShape,
  events: EngagementEventLite[],
  meetings: PersonMeetingLite[],
  actions: PersonActionLite[],
  artifacts: PersonArtifactLite[] = [],
  now: Date = new Date(),
): PersonContext {
  const frame = monthFrame(now);
  const engagement = deriveEngagement(person.days, events, now);
  const topics = topicRows(meetings);
  const openActions = actions.filter((a) => !a.done).map(toActionRow);
  const doneActions = actions.filter((a) => a.done).map(toActionRow);

  // Calendar: the real current month; dots only where real meetings happened.
  const meetingsByDay = new Map<number, PersonMeetingLite[]>();
  for (const meeting of meetings) {
    if (!isCurrentMonth(meeting.startedAt, now)) continue;
    const day = dayOfMonth(meeting.startedAt);
    const list = meetingsByDay.get(day);
    if (list) list.push(meeting);
    else meetingsByDay.set(day, [meeting]);
  }
  const actionsByMeeting = new Map<string, PersonActionLite[]>();
  for (const action of actions) {
    const list = actionsByMeeting.get(action.meetingId);
    if (list) list.push(action);
    else actionsByMeeting.set(action.meetingId, [action]);
  }

  const calendar: PersonCalendarDay[] = [];
  for (let day = 1; day <= frame.daysInMonth; day++) {
    const dayMeetings = meetingsByDay.get(day) ?? [];
    let detail: PersonDayDetail | null = null;
    const meeting = dayMeetings[0];
    if (meeting) {
      const owned = actionsByMeeting.get(meeting.id) ?? [];
      detail = {
        title: `${weekdayShortOf(meeting.startedAt)}, ${dateLabel(meeting.startedAt)} · with ${person.name}`,
        typeLabel: meeting.source === 'recorder' ? 'Recorded' : 'Meeting',
        type: 'Meeting',
        fromMeeting: true,
        summary: firstSentence(meeting.summary, 220),
        items: owned.slice(0, 2).map((a) => ({ kind: 'ACTION' as const, text: a.title })),
      };
    }
    calendar.push({
      day,
      isToday: day === frame.today,
      dots: dayMeetings.slice(0, 2).map(() => 'Meeting' as const),
      detail,
    });
  }

  const timeline: PersonTimelineEntry[] = meetings.map((meeting) => ({
    dateLabel: `${weekdayShortOf(meeting.startedAt)} · ${dateLabel(meeting.startedAt)}`,
    type: 'Meeting',
    fromMeeting: true,
    title: `Meeting · ${meeting.title}`,
    snippet: firstSentence(meeting.summary),
  }));

  const topicNames = topics.slice(0, 3).map((t) => t.name);
  const summary = meetings.length
    ? `Primarily involved in ${person.func} initiatives at ${person.location}. Recent meetings have focused on ${topicNames.join(', ')}. ${openActions.length} action item${openActions.length === 1 ? '' : 's'} open from processed meetings. Cadence is ${freqLabel(person.days).toLowerCase()} and the relationship is ${TREND_WORD[engagement.trend]}.`
    : `Part of ${person.func} at ${person.location}. Cadence is ${freqLabel(person.days).toLowerCase()}. No processed meetings yet — IRIS builds living context here as meetings are recorded.`;

  const { total, latestTitle } = boostOf(events);
  const latestEvent = events.length ? events[events.length - 1]! : null;

  return {
    summary,
    boostNote:
      total > 0 && latestTitle && latestEvent
        ? `Engagement +${total} from "${latestTitle}" — recorded ${dateLabel(latestEvent.occurredOn)} in Meetings. Summary, actions and topics refreshed.`
        : null,
    monthLabel: frame.monthLabel,
    monthShort: frame.monthShort,
    calendarLeadingBlanks: frame.leadingBlanks,
    healthPct: engagement.score,
    calendar,
    timeline,
    topics,
    openActions,
    doneActions,
    // Real artifacts extracted from this person's meetings (empty until some exist).
    files: artifacts.map(toFileRow),
    insights: insightRows(meetings, actions, topics),
  };
}
