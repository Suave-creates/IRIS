/** Application-wide constants shared between server and web. */

export const APP_NAME = 'IRIS';
export const APP_TAGLINE = 'Executive OS';

/** The canonical set of top-level views (matches the design's nav + router). */
export const VIEW_KEYS = [
  'onboarding',
  'chat',
  'dashboard',
  'projects',
  'mail',
  'calendar',
  'journal',
  'people',
  'meetings',
  'whiteboard',
  'knowledge',
  'connectors',
  'memory',
  'admin',
  'settings',
  'architecture',
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];

/** Human titles shown in the header for each view (verbatim from the design). */
export const VIEW_TITLES: Record<ViewKey, string> = {
  onboarding: 'Welcome',
  chat: 'Ask IRIS',
  dashboard: 'Dashboard',
  projects: 'Projects',
  mail: 'Mail Intelligence',
  calendar: 'Calendar',
  journal: 'Journal',
  people: 'People & Context',
  meetings: 'Meeting Intelligence',
  whiteboard: 'Smart Whiteboard',
  knowledge: 'Lens',
  connectors: 'Connectors',
  memory: 'Memory & Context',
  admin: 'Admin',
  settings: 'Settings',
  architecture: 'System Architecture',
};

/** URL path for each view (the router uses these). `dashboard` is the index. */
export const VIEW_PATHS: Record<ViewKey, string> = {
  onboarding: '/welcome',
  chat: '/chat',
  dashboard: '/',
  projects: '/projects',
  mail: '/mail',
  calendar: '/calendar',
  journal: '/journal',
  people: '/people',
  meetings: '/meetings',
  whiteboard: '/whiteboard',
  knowledge: '/lens',
  connectors: '/connectors',
  memory: '/memory',
  admin: '/admin',
  settings: '/settings',
  architecture: '/architecture',
};

/** RBAC roles, ordered from most to least privileged. */
export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** People & Context: relationship categories, in roster display order. */
export const PERSON_CATEGORIES = ['Direct', 'Direct-1', 'Direct-2', 'Indirect', 'Agent', 'Support'] as const;
export type PersonCategory = (typeof PERSON_CATEGORIES)[number];

/** Org functions a person can belong to (also the keys of the topic pools). */
export const PERSON_FUNCTIONS = [
  'Operations',
  'WH',
  'Frame',
  'Lens Lab',
  'Engineering',
  'Quality',
  'Quality/Projects',
  'Projects',
  'HR',
  'Finance',
  'Commercial',
  'KPI',
  'AI',
  'Packaging',
] as const;
export type PersonFunction = (typeof PERSON_FUNCTIONS)[number];

/**
 * Default site-code suggestions. Locations are user-extensible short codes
 * (2–12 chars, letters/digits, stored uppercase) — any new code entered in the
 * person form or a bulk paste becomes a first-class location.
 */
export const PERSON_LOCATIONS = ['GGN', 'BWD', 'HYD'] as const;
export type PersonLocation = string;

/** Canonical form of a site code: trimmed + uppercased. */
export function normalizeLocation(code: string): string {
  return code.trim().toUpperCase();
}

/** Valid site code: 2–12 letters/digits. */
export function isValidLocation(code: string): boolean {
  return /^[A-Z0-9]{2,12}$/.test(normalizeLocation(code));
}

/** How a meeting was captured. */
export const MEETING_MODES = ['online', 'inroom'] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

/** Cadence labels by engagement-day count (index = number of days). */
export const FREQ_LABELS = [
  'No days set',
  'Once a week',
  'Twice a week',
  'Thrice a week',
  '4 days a week',
  'Daily',
  '6 days a week',
] as const;

/** Cadence label for a number of engagement days (used by server derivation and optimistic UI). */
export function freqLabel(dayCount: number): string {
  return FREQ_LABELS[dayCount] ?? 'Daily';
}

/* The scripted demo recording (MEETING_DEMO_KEY / MEETING_DEMO_SCRIPT) was
 * removed: the recorder captures REAL speech via the browser's speech engine
 * and every transcript is processed by real AI extraction. */

/** Priority levels used across projects, tasks and mail. */
export const PRIORITIES = ['critical', 'high', 'med', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Approval lifecycle for AI-prepared actions (the approval gate). */
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'executed', 'failed'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Connector providers IRIS knows about. */
export const CONNECTOR_PROVIDERS = [
  'gmail',
  'gcalendar',
  'gdrive',
  'gsheets',
  'slack',
  'notion',
  'github',
  'jira',
] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const CONNECTOR_STATUSES = ['connected', 'degraded', 'expiring', 'disconnected', 'error'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];
