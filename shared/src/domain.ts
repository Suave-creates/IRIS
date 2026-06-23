import type { ConnectorProvider, ConnectorStatus, Priority, Role } from './constants.js';

// ── Projects ────────────────────────────────────────────────────────────────
export type ProjectSourceType = 'manual' | 'calendar' | 'journal' | 'conversation' | 'sheet' | 'doc' | 'folder';

export interface ProjectField {
  id: string;
  label: string;
  value: string;
}
export interface ProjectTask {
  id: string;
  title: string;
  done: boolean;
}
export interface ProjectFileRef {
  name: string;
  kind: string;
}
export interface ProjectActivity {
  who: string;
  act: string;
  time: string;
}
export interface Project {
  id: string;
  name: string;
  source: ProjectSourceType;
  priority: Priority;
  status: string;
  deadline: string | null;
  progress: number;
  owner: string;
  auto: boolean;
  summary: string;
  sourceDetail: string | null;
  stages: string[];
  currentStage: number;
  fields: ProjectField[];
  tasks: ProjectTask[];
  files: ProjectFileRef[];
  activity: ProjectActivity[];
}
export interface ProjectSource {
  id: string;
  type: 'folder' | 'sheet' | 'doc';
  name: string;
  meta: string | null;
  status: 'linked' | 'scanning' | 'scanned';
  externalId: string | null;
  webLink: string | null;
}
/** A real item available to link, listed live from a connector (Google Drive). */
export interface AvailableSource {
  externalId: string;
  name: string;
  type: 'folder' | 'sheet' | 'doc';
  webLink: string | null;
}
export interface CreateProjectInput {
  name: string;
  priority: Priority;
  deadline?: string | null;
  /** Optional context IRIS uses to write the AI card summary. */
  description?: string | null;
}
/** Partial update for "edit everything" on a project card. */
export interface UpdateProjectInput {
  name?: string;
  priority?: Priority;
  deadline?: string | null;
  status?: string;
  owner?: string;
  summary?: string;
  progress?: number;
  currentStage?: number;
}

// ── Journal ───────────────────────────────────────────────────────────────
export type TaskPriority = 'high' | 'med' | 'low';
export interface JournalTask {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string | null;
  priority: TaskPriority;
  done: boolean;
  detail: string | null;
}
export interface JournalTaskInput {
  title: string;
  dueDate: string;
  dueTime?: string | null;
  priority: TaskPriority;
  done?: boolean;
  detail?: string | null;
}

// ── Calendar ──────────────────────────────────────────────────────────────
export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string; // ISO
  endAt: string; // ISO
  color: string;
  location: string | null;
  notes: string | null;
  attendees: number;
}
export interface CalendarEventInput {
  title: string;
  startAt: string;
  endAt: string;
  color: string;
  location?: string | null;
  notes?: string | null;
  /** Guest email addresses to invite via Google Calendar. */
  attendees?: string[];
}

// ── Mail ──────────────────────────────────────────────────────────────────
export interface MailItem {
  id: string;
  fromName: string;
  subject: string;
  summary: string | null;
  category: string;
  priority: TaskPriority;
  receivedAt: string; // YYYY-MM-DD
  tags: string[];
}
export interface MailStats {
  indexed: number;
  categories: { key: string; count: number }[];
}

// ── Memory + knowledge graph ────────────────────────────────────────────────
export type MemoryType = 'preference' | 'fact' | 'contact' | 'project' | 'correction';
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  source: string | null;
  confidence: number | null;
  scope: 'short' | 'long';
  createdAt: string;
}
export interface KnowledgeGraph {
  nodes: { id: string; label: string; kind: string }[];
  edges: { from: string; to: string; relation: string | null }[];
}
export interface MemoryOverview {
  counts: { shortTerm: number; longTerm: number; nodes: number; edges: number; preferences: number };
  recent: Memory[];
  graph: KnowledgeGraph;
}

// ── Connectors ──────────────────────────────────────────────────────────────
export interface Connector {
  id: string;
  provider: ConnectorProvider;
  displayName: string;
  groupLabel: string;
  status: ConnectorStatus;
  capabilities: string | null;
  lastSyncedAt: string | null;
  note: string | null;
}

// ── Notifications ────────────────────────────────────────────────────────────
export interface Notification {
  id: string;
  title: string;
  body: string | null;
  dotColor: string;
  read: boolean;
  createdAt: string;
}

// ── AI actions (approval gate) ────────────────────────────────────────────────
export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
export interface ActionProposal {
  id: string;
  kind: string;
  target: string;
  title: string;
  detail: string | null;
  status: ActionStatus;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export type Tone = 'danger' | 'warn' | 'neutral' | 'accent' | 'info' | 'success';
export interface DashboardPriority {
  id: string;
  rank: number;
  title: string;
  detail: string | null;
  tag: string | null;
  tagTone: Tone;
}
export interface DashboardDeadline {
  id: string;
  title: string;
  weekday: string;
  day: number;
  daysLabel: string;
  tone: Tone;
}
export interface DashboardRisk {
  id: string;
  title: string;
  detail: string | null;
  severity: TaskPriority;
}
export interface DashboardNextMeeting {
  title: string;
  timeLabel: string;
  attendees: number;
  location: string | null;
  inLabel: string;
  brief: string | null;
}
export interface DashboardData {
  dateLabel: string;
  greeting: string;
  briefing: { priorities: number; deadlines: number; approvals: number };
  priorities: DashboardPriority[];
  pendingApprovals: number;
  deadlines: DashboardDeadline[];
  risks: DashboardRisk[];
  nextMeeting: DashboardNextMeeting | null;
  lastSync: string;
}

// ── Chat + Context Engine ─────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'iris';
  text: string;
  createdAt: string;
  hasActions?: boolean;
}
/** A piece of context the engine selected and injected (shown in the context rail). */
export interface ChatContextSource {
  id: string;
  kind: 'memory' | 'mail' | 'calendar' | 'project' | 'task' | 'action';
  label: string;
  sublabel: string;
  relevance: number; // 0–100
}
/** The terminal SSE event of a chat turn. */
export interface ChatTurnResult {
  conversationId: string;
  sources: ChatContextSource[];
  tokens: { used: number; window: number };
  actionsPrepared: number;
}

// ── Lens ──────────────────────────────────────────────────────────────────────
export interface LensResult {
  kind: string;
  source: string;
  icon: string;
  title: string;
  snippet: string;
  meta: string;
}
export interface LensGather {
  keyword: string;
  summary: string;
  results: LensResult[];
  sources: string[];
}

// ── Whiteboard (Smart Whiteboard) ─────────────────────────────────────────────
export type WhiteboardKind = 'sheet' | 'doc' | 'folder' | 'pdf' | 'slide' | 'insight';
/** A window on the canvas — a connector-backed file or an AI-generated insight. */
export interface WhiteboardItem {
  id: string;
  kind: WhiteboardKind;
  title: string;
  externalId: string | null;
  webLink: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  aiIncluded: boolean;
  /** Insight body text (only for kind === 'insight'). */
  body: string | null;
  createdAt: string;
}
/** Adds a known connector file (chosen from the linked-sources library) to the canvas. */
export interface AddWhiteboardItemInput {
  kind: 'sheet' | 'doc' | 'folder';
  externalId: string;
  title: string;
  webLink?: string | null;
  x?: number;
  y?: number;
}
/** Adds a file to the canvas by pasted Google URL or ID. */
export interface AddWhiteboardByRefInput {
  kind: 'sheet' | 'doc' | 'folder';
  ref: string;
  x?: number;
  y?: number;
}
/** Partial update from drag / resize / AI toggle / rename. */
export interface UpdateWhiteboardItemInput {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  aiIncluded?: boolean;
  title?: string;
}
export type WhiteboardAiAction = 'summarize' | 'reconcile' | 'board' | 'custom';
/** Runs cross-file AI over every AI-included window; returns a new insight window. */
export interface WhiteboardAiInput {
  action: WhiteboardAiAction;
  prompt?: string;
}

/** A visual block Claude can emit for an insight window. */
export type InsightBlock =
  | { type: 'markdown'; text: string }
  | { type: 'kpis'; items: { label: string; value: string; sub?: string | null }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | {
      type: 'chart';
      chart: 'line' | 'bar';
      title?: string | null;
      xLabel?: string | null;
      yLabel?: string | null;
      series: { name: string; points: { x: string; y: number }[] }[];
    };
/** A rendered insight: a title + ordered visual blocks. Stored as JSON in WhiteboardItem.body. */
export interface WhiteboardInsight {
  title: string;
  blocks: InsightBlock[];
}

// ── Admin ────────────────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  connectorCount: number;
}
export interface AdminAuditEntry {
  id: string;
  time: string;
  action: string;
  actor: string | null;
}
export interface AdminOverview {
  stats: { activeUsers: number; connectors: number; memories: number; pendingApprovals: number };
  users: AdminUser[];
  systemHealth: { name: string; status: 'operational' | 'elevated' | 'down' }[];
  audit: AdminAuditEntry[];
}
