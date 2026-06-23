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
