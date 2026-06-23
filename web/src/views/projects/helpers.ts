import type { BadgeTone } from '@/components/primitives';
import type { Priority, ProjectSourceType } from '@iris/shared';

/** Priority pill tone + label, matching the prototype's colour mapping. */
export const PRIORITY_META: Record<Priority, { tone: BadgeTone; label: string }> = {
  critical: { tone: 'danger', label: 'Critical' },
  high: { tone: 'warn', label: 'High' },
  med: { tone: 'info', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
};

/** Coloured source dot + human label per source type. */
export const SOURCE_META: Record<ProjectSourceType, { color: string; label: string }> = {
  manual: { color: 'var(--text-3)', label: 'Manual' },
  calendar: { color: 'var(--info)', label: 'Calendar' },
  journal: { color: 'var(--warn)', label: 'Journal' },
  conversation: { color: 'var(--violet)', label: 'Conversation' },
  sheet: { color: 'var(--success)', label: 'Sheet' },
  doc: { color: 'var(--accent)', label: 'Doc' },
  folder: { color: 'var(--info)', label: 'Folder' },
};

/** Status colour: the prototype keys colour off the status word. */
export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (/(risk|block|overdue|delay|stalled)/.test(s)) return 'var(--danger)';
  if (/(review|pending|wait|hold)/.test(s)) return 'var(--warn)';
  if (/(done|complete|shipped|live|launched)/.test(s)) return 'var(--success)';
  if (/(track|progress|active|building|design)/.test(s)) return 'var(--success)';
  return 'var(--info)';
}

/** Deadline display: pass-through for human strings, else a tidy date. */
export function deadlineLabel(deadline: string | null): string {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline);
  if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(deadline)) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return deadline;
}
