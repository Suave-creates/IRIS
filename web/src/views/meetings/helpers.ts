import type { Meeting, MeetingSentiment } from '@iris/shared';
import { AGENT_PINK, GGN_TEAL, SUPPORT_ORANGE, THU_PURPLE, alpha } from '@/lib/color';

// ── Non-token design hues (single-sourced in @/lib/color) ────────────────────
export { AGENT_PINK, GGN_TEAL, SUPPORT_ORANGE, THU_PURPLE, alpha };

// ── Speakers ──────────────────────────────────────────────────────────────────
/** Colours for capture-channel labels; named speakers get a stable palette pick. */
const CHANNEL_COLORS: Record<string, string> = {
  You: 'var(--accent)',
  Mic: 'var(--accent)',
  Call: 'var(--info)',
};

const SPEAKER_PALETTE: readonly string[] = ['var(--success)', 'var(--info)', 'var(--warn)', GGN_TEAL, AGENT_PINK, THU_PURPLE];

/** Transcript colour for a speaker label — stable across renders. */
export function speakerColor(speaker: string): string {
  const pinned = CHANNEL_COLORS[speaker];
  if (pinned) return pinned;
  let h = 0;
  for (let i = 0; i < speaker.length; i++) h = (h * 31 + speaker.charCodeAt(i)) % 997;
  return SPEAKER_PALETTE[h % SPEAKER_PALETTE.length]!;
}

// ── Artifacts ─────────────────────────────────────────────────────────────────
/** Chip tint per artifact kind slug; unknown kinds fall back to neutral. */
const ARTIFACT_TONES: Record<string, { color: string; bg: string } | undefined> = {
  url: { color: 'var(--info)', bg: 'var(--info-soft)' },
  git: { color: THU_PURPLE, bg: alpha(THU_PURPLE, 0.1) },
  github: { color: THU_PURPLE, bg: alpha(THU_PURPLE, 0.1) },
  linear: { color: THU_PURPLE, bg: alpha(THU_PURPLE, 0.1) },
  jira: { color: 'var(--info)', bg: 'var(--info-soft)' },
  doc: { color: 'var(--info)', bg: 'var(--info-soft)' },
  gdoc: { color: 'var(--info)', bg: 'var(--info-soft)' },
  drive: { color: 'var(--info)', bg: 'var(--info-soft)' },
  notion: { color: 'var(--info)', bg: 'var(--info-soft)' },
  confluence: { color: 'var(--info)', bg: 'var(--info-soft)' },
  sheet: { color: 'var(--success)', bg: 'var(--success-soft)' },
  pdf: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
  figma: { color: AGENT_PINK, bg: alpha(AGENT_PINK, 0.1) },
};
const ARTIFACT_TONE_DEFAULT = { color: 'var(--text-2)', bg: 'var(--surface-3)' } as const;

/** [text colour, tinted background] for an artifact kind chip. */
export function artifactTone(kind: string): { color: string; bg: string } {
  return ARTIFACT_TONES[kind.trim().toLowerCase()] ?? ARTIFACT_TONE_DEFAULT;
}

// ── Recorder ──────────────────────────────────────────────────────────────────
/**
 * Maps a browser recognition locale onto the server's Whisper language hint:
 * hi-IN → 'hi', everything else (en-IN/en-US/…) → 'en'.
 */
export function sttLanguage(locale: string): string {
  return locale.trim().toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

/** The 10 processing-pipeline chips (advance ~480ms apart). */
export const PIPELINE_STEPS: readonly string[] = [
  'Transcribe',
  'Speakers',
  'Summary',
  'Actions',
  'Decisions',
  'Deadlines',
  'People',
  'Projects',
  'Risks',
  'Follow-ups',
];

// ── List presentation ─────────────────────────────────────────────────────────
/** Tinted [background, colour] pairs for the 44px date blocks, keyed by weekday. */
export const DAY_BLOCK_COLORS: Record<string, readonly [string, string]> = {
  FRI: ['var(--info-soft)', 'var(--info)'],
  WED: ['var(--success-soft)', 'var(--success)'],
  THU: [alpha(THU_PURPLE, 0.1), THU_PURPLE],
  MON: ['var(--warn-soft)', 'var(--warn)'],
  TUE: ['var(--success-soft)', GGN_TEAL],
  SAT: ['var(--danger-soft)', 'var(--danger)'],
};

/** Date-block tint for a weekday label, with the prototype's neutral fallback. */
export function dayBlockColors(dow: string): readonly [string, string] {
  return DAY_BLOCK_COLORS[dow] ?? ['var(--surface-3)', 'var(--text-2)'];
}

/** Sentiment dot + word colour per sentiment. */
export const SENTIMENT_COLORS: Record<MeetingSentiment, string> = {
  Positive: 'var(--success)',
  Mixed: 'var(--warn)',
  Neutral: 'var(--text-3)',
};

/** Search suggestion chips (click fills the query). */
export const SUGGESTIONS: readonly string[] = ['ASRS decisions', 'open commitments to Raj', 'risks this week'];

/** Filler words dropped before token matching so phrasing doesn't defeat the search. */
const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'this', 'to', 'with']);

/** Everything searchable about a meeting, lowercased (includes actions/decisions/risks). */
function haystack(m: Meeting): string {
  return [
    m.title,
    ...m.topics,
    ...m.participants,
    m.summary,
    ...m.actions.map((a) => a.title),
    ...m.decisions.map((d) => d.title),
    ...m.risks,
    ...m.followups,
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Natural-language match: an exact-phrase hit always matches; otherwise any
 * meaningful query token found in the meeting's text counts (so "open
 * commitments to Raj" surfaces Raj's meetings instead of nothing). Ranking by
 * token overlap happens in matchScore.
 */
export function matchesQuery(m: Meeting, q: string): boolean {
  return matchScore(m, q) > 0;
}

/** Relevance score for list ordering: phrase hits outrank token hits. */
export function matchScore(m: Meeting, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return 1;
  const text = haystack(m);
  if (text.includes(needle)) return 1000;
  const tokens = needle.split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  if (!tokens.length) return 0;
  return tokens.reduce((score, token) => (text.includes(token) ? score + 1 : score), 0);
}

/** Formats elapsed seconds as MM:SS (recorder timer + live transcript timestamps). */
export function fmtMmss(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}
