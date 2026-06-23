import type { RowDataPacket } from 'mysql2/promise';
import { query } from '../../db/pool.js';

/** A candidate piece of context, before ranking. */
export interface Candidate {
  id: string;
  kind: 'memory' | 'mail' | 'calendar' | 'project' | 'task' | 'action';
  label: string;
  sublabel: string;
  /** Full text used for relevance scoring + injection. */
  text: string;
  /** Epoch ms used for recency scoring (0 if unknown). */
  recencyTs: number;
  /** Base importance weight by type (0–1). */
  baseWeight: number;
}

interface Row extends RowDataPacket {
  [k: string]: unknown;
}

/**
 * GATHER stage — pulls candidate context from across the tenant's workspace.
 * Bounded per source so ranking stays cheap. Tenant-scoped throughout.
 */
export async function gather(tenantId: string, userId: string): Promise<Candidate[]> {
  const out: Candidate[] = [];

  const memories = await query<Row[]>(
    `SELECT id, type, content, source, created_at FROM memories
     WHERE tenant_id = :t ORDER BY created_at DESC LIMIT 40`,
    { t: tenantId },
  );
  for (const m of memories) {
    out.push({
      id: String(m.id),
      kind: 'memory',
      label: String(m.content).slice(0, 80),
      sublabel: `Memory · ${String(m.type)}${m.source ? ` · ${String(m.source)}` : ''}`,
      text: `${String(m.type)}: ${String(m.content)}`,
      recencyTs: Date.parse(String(m.created_at)) || 0,
      baseWeight: m.type === 'preference' || m.type === 'correction' ? 0.95 : 0.8,
    });
  }

  const mail = await query<Row[]>(
    `SELECT id, from_name, subject, summary, category, received_at FROM mail_items
     WHERE tenant_id = :t ORDER BY received_at DESC LIMIT 25`,
    { t: tenantId },
  );
  for (const m of mail) {
    out.push({
      id: String(m.id),
      kind: 'mail',
      label: String(m.subject),
      sublabel: `Email · ${String(m.from_name)}`,
      text: `Email from ${String(m.from_name)} — ${String(m.subject)}: ${String(m.summary ?? '')}`,
      recencyTs: Date.parse(String(m.received_at)) || 0,
      baseWeight: m.category === 'approvals' || m.category === 'deadlines' ? 0.85 : 0.65,
    });
  }

  const events = await query<Row[]>(
    `SELECT id, title, start_at, location, notes FROM calendar_events
     WHERE tenant_id = :t AND end_at >= NOW() ORDER BY start_at LIMIT 15`,
    { t: tenantId },
  );
  for (const e of events) {
    out.push({
      id: String(e.id),
      kind: 'calendar',
      label: String(e.title),
      sublabel: `Calendar · ${String(e.start_at)}`,
      text: `Upcoming meeting "${String(e.title)}" at ${String(e.start_at)}${e.location ? ` (${String(e.location)})` : ''}. ${String(e.notes ?? '')}`,
      recencyTs: Date.now() + 1, // upcoming → freshest
      baseWeight: 0.75,
    });
  }

  const projects = await query<Row[]>(
    `SELECT id, name, summary, status, priority, deadline FROM projects
     WHERE tenant_id = :t ORDER BY FIELD(priority,'critical','high','med','low') LIMIT 20`,
    { t: tenantId },
  );
  for (const p of projects) {
    out.push({
      id: String(p.id),
      kind: 'project',
      label: String(p.name),
      sublabel: `Project · ${String(p.status)}`,
      text: `Project "${String(p.name)}" (${String(p.priority)}, ${String(p.status)}): ${String(p.summary ?? '')}${p.deadline ? ` Deadline ${String(p.deadline)}.` : ''}`,
      recencyTs: Date.now(),
      baseWeight: p.priority === 'critical' ? 0.9 : 0.7,
    });
  }

  const tasks = await query<Row[]>(
    `SELECT id, title, due_date, priority, detail FROM journal_tasks
     WHERE tenant_id = :t AND user_id = :u AND done = 0 ORDER BY due_date LIMIT 20`,
    { t: tenantId, u: userId },
  );
  for (const tk of tasks) {
    out.push({
      id: String(tk.id),
      kind: 'task',
      label: String(tk.title),
      sublabel: `Task · due ${String(tk.due_date)}`,
      text: `Task "${String(tk.title)}" due ${String(tk.due_date)} (${String(tk.priority)}). ${String(tk.detail ?? '')}`,
      recencyTs: Date.now(),
      baseWeight: tk.priority === 'high' ? 0.8 : 0.6,
    });
  }

  const actions = await query<Row[]>(
    `SELECT id, kind, target, title, detail FROM actions
     WHERE tenant_id = :t AND status = 'pending' ORDER BY created_at DESC LIMIT 10`,
    { t: tenantId },
  );
  for (const a of actions) {
    out.push({
      id: String(a.id),
      kind: 'action',
      label: String(a.title),
      sublabel: `Pending approval · ${String(a.kind)}`,
      text: `Pending action (${String(a.kind)} → ${String(a.target)}): ${String(a.title)}. ${String(a.detail ?? '')}`,
      recencyTs: Date.now(),
      baseWeight: 0.7,
    });
  }

  return out;
}
