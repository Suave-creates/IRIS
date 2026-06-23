import type { ActionStatus } from '@iris/shared';
import { execute } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import type { ActionRow } from './actions.repo.js';

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const pad = (n: number) => String(n).padStart(2, '0');

/** ISO/loose datetime → MySQL DATETIME (UTC), or null. */
function toDateTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}
function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const today = () => toDate(new Date().toISOString())!;
const priorityOf = (v: unknown): 'high' | 'med' | 'low' => {
  const s = String(v ?? '').toLowerCase();
  return s === 'high' || s === 'low' ? s : 'med';
};

/**
 * Executes an approved action that maps to an internal write (task, event, memory).
 * External actions (email, record updates) remain 'approved' — real delivery wires
 * up with the connector framework in M4. Returns the resulting status.
 */
export async function executeApprovedAction(row: ActionRow): Promise<ActionStatus> {
  const p = parsePayload(row.payload);
  try {
    switch (row.kind) {
      case 'Create task': {
        await execute(
          `INSERT INTO journal_tasks (id, tenant_id, user_id, title, due_date, due_time, priority, detail)
           VALUES (:id, :t, :u, :title, :dd, :tm, :pr, :detail)`,
          {
            id: id('jt'),
            t: row.tenant_id,
            u: row.user_id,
            title: str(p.title) ?? row.title,
            dd: toDate(p.dueDate) ?? today(),
            tm: str(p.time),
            pr: priorityOf(p.priority),
            detail: str(p.detail) ?? row.detail,
          },
        );
        break;
      }
      case 'Calendar event': {
        const startAt = toDateTime(p.startAt);
        const endAt = toDateTime(p.endAt) ?? startAt;
        if (!startAt) return 'approved'; // not enough data to schedule — leave approved
        await execute(
          `INSERT INTO calendar_events (id, tenant_id, user_id, title, start_at, end_at, color, location, notes, source)
           VALUES (:id, :t, :u, :title, :s, :e, '#4b49d6', :loc, :notes, 'iris')`,
          {
            id: id('evt'),
            t: row.tenant_id,
            u: row.user_id,
            title: str(p.title) ?? row.title,
            s: startAt,
            e: endAt,
            loc: str(p.location),
            notes: str(p.notes) ?? row.detail,
          },
        );
        break;
      }
      case 'Save memory': {
        await execute(
          `INSERT INTO memories (id, tenant_id, type, content, source, scope) VALUES (:id, :t, :ty, :c, :s, 'long')`,
          {
            id: id('mem'),
            t: row.tenant_id,
            ty: ['preference', 'fact', 'contact', 'project', 'correction'].includes(String(p.type))
              ? String(p.type)
              : 'fact',
            c: str(p.content) ?? row.title,
            s: str(p.source) ?? 'approved in chat',
          },
        );
        break;
      }
      default:
        // Draft email / Update record / anything external → awaits connector delivery (M4).
        return 'approved';
    }
    await setStatus(row.tenant_id, row.id, 'executed');
    return 'executed';
  } catch (err) {
    logger.error({ err, actionId: row.id, kind: row.kind }, 'action execution failed');
    await setStatus(row.tenant_id, row.id, 'failed');
    return 'failed';
  }
}

async function setStatus(tenantId: string, actionId: string, status: ActionStatus): Promise<void> {
  await execute('UPDATE actions SET status = :s WHERE id = :id AND tenant_id = :t', {
    s: status,
    id: actionId,
    t: tenantId,
  });
}
