import { PERSON_CATEGORIES, freqLabel } from '@iris/shared';
import type { EngagementStatus, EngagementTrend, PersonCategory, PersonInteractionType, Priority } from '@iris/shared';
import {
  AGENT_PINK,
  DIRECT2_AMBER,
  GGN_TEAL,
  SUPPORT_ORANGE,
  THU_PURPLE,
  WED_NEUTRAL,
  alpha,
  initials,
} from '@/lib/color';

/* ── Non-token design hues (single-sourced in @/lib/color) ────────────────── */

export { AGENT_PINK, DIRECT2_AMBER, GGN_TEAL, SUPPORT_ORANGE, THU_PURPLE, WED_NEUTRAL, alpha, initials, freqLabel };

/** BWD location blue (token-mapped). */
export const BWD_BLUE = 'var(--info)';

/* ── Location colours (site codes are user-extensible) ────────────────────── */

const LOCATION_PINNED: Record<string, string> = {
  GGN: GGN_TEAL,
  BWD: BWD_BLUE,
  HYD: THU_PURPLE,
};

const LOCATION_PALETTE: readonly string[] = [
  SUPPORT_ORANGE,
  AGENT_PINK,
  DIRECT2_AMBER,
  'var(--success)',
  'var(--warn)',
  THU_PURPLE,
];

/** Colour for a site code: design-pinned for GGN/BWD/HYD, stable palette pick otherwise. */
export function locationColor(code: string): string {
  const pinned = LOCATION_PINNED[code];
  if (pinned) return pinned;
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 997;
  return LOCATION_PALETTE[h % LOCATION_PALETTE.length]!;
}

/* ── Category metadata ────────────────────────────────────────────────────── */

/** Category swatch/avatar colours (CC in the prototype). */
export const CATEGORY_COLORS: Record<PersonCategory, string> = {
  Direct: 'var(--info)',
  'Direct-1': 'var(--success)',
  'Direct-2': DIRECT2_AMBER,
  Indirect: THU_PURPLE,
  Agent: AGENT_PINK,
  Support: SUPPORT_ORANGE,
};

/** Roster section order (matches the shared constant). */
export const CATEGORY_ORDER = PERSON_CATEGORIES;

export type PeopleFilterCat = 'all' | PersonCategory;

/** Filter chip order from the prototype (note: Agent before Indirect, no Direct-2). */
export const FILTER_CATS: readonly PeopleFilterCat[] = ['all', 'Direct', 'Direct-1', 'Agent', 'Indirect', 'Support'];

/* ── Day metadata (index 0 = Mon = day 1 … index 5 = Sat = day 6) ─────────── */

export interface DayMeta {
  name: string;
  color: string;
  theme: string;
}

/** Weekly engagement day columns: name, colour, and the day's theme line. */
export const DAY_META: readonly DayMeta[] = [
  { name: 'Mon', color: GGN_TEAL, theme: 'GGN meetings' },
  { name: 'Tue', color: 'var(--success)', theme: 'Free · open' },
  { name: 'Wed', color: WED_NEUTRAL, theme: 'General' },
  { name: 'Thu', color: THU_PURPLE, theme: 'Frame · Engg · Projects' },
  { name: 'Fri', color: 'var(--info)', theme: 'Operations WBR' },
  { name: 'Sat', color: 'var(--warn)', theme: 'Light functions' },
];

/* ── Interaction / status / trend colour maps ─────────────────────────────── */

/** Calendar dot + timeline colours per interaction type. */
export const INTERACTION_COLORS: Record<PersonInteractionType, string> = {
  Meeting: 'var(--accent)',
  Call: 'var(--success)',
  Discussion: 'var(--info)',
  Note: 'var(--warn)',
};

/** Engagement status → score/health colour. */
export const STATUS_COLORS: Record<EngagementStatus, string> = {
  'Highly Active': 'var(--success)',
  Active: GGN_TEAL,
  Moderate: 'var(--warn)',
  'Low Activity': 'var(--text-3)',
  Dormant: 'var(--danger)',
};

export interface TrendMeta {
  arrow: string;
  word: string;
  color: string;
}

/** Trend arrow/word/colour per engagement trend. */
export const TREND: Record<EngagementTrend, TrendMeta> = {
  rising: { arrow: '↑', word: 'Rising', color: 'var(--success)' },
  steady: { arrow: '→', word: 'Steady', color: 'var(--text-3)' },
  cooling: { arrow: '↓', word: 'Cooling', color: 'var(--warn)' },
};

/** Project priority chip colour (Actions-tab project rows — matches the Projects view's tones). */
export const PROJECT_PRIORITY_COLORS: Record<Priority, string> = {
  critical: 'var(--danger)',
  high: 'var(--warn)',
  med: 'var(--info)',
  low: 'var(--text-3)',
};

/** Topics tab bar palette, rotating accent → info → teal → warn → pink. */
export const TOPIC_BAR_COLORS: readonly string[] = [
  'var(--accent)',
  'var(--info)',
  GGN_TEAL,
  'var(--warn)',
  AGENT_PINK,
];

/* Pure helpers (`alpha`, `initials` from @/lib/color; `freqLabel` from @iris/shared) are re-exported above. */
