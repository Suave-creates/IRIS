import type { RowDataPacket } from 'mysql2/promise';
import type { ActionProposal, ActionStatus } from '@iris/shared';
import { execute, query } from '../../db/pool.js';

/** Raw `actions` row as returned by MySQL (snake_case, dateStrings). */
export interface ActionRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  target: string;
  title: string;
  detail: string | null;
  payload: string | null;
  status: ActionStatus;
  created_at: string;
  decided_at: string | null;
}

/** Maps a DB row → the public ActionProposal DTO. */
export function toActionProposal(row: ActionRow): ActionProposal {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    title: row.title,
    detail: row.detail ?? null,
    status: row.status,
  };
}

export const actionRepo = {
  /**
   * Lists actions for a tenant, optionally filtered by status.
   * Tenant isolation: every row is constrained to the caller's tenant.
   */
  async listByTenant(tenantId: string, status?: ActionStatus): Promise<ActionRow[]> {
    if (status) {
      return query<ActionRow[]>(
        'SELECT * FROM actions WHERE tenant_id = :tid AND status = :status ORDER BY created_at DESC',
        { tid: tenantId, status },
      );
    }
    return query<ActionRow[]>(
      'SELECT * FROM actions WHERE tenant_id = :tid ORDER BY created_at DESC',
      { tid: tenantId },
    );
  },

  /** Fetches a single action scoped to the tenant (returns null if not found / other tenant). */
  async findByIdForTenant(tenantId: string, actionId: string): Promise<ActionRow | null> {
    const rows = await query<ActionRow[]>(
      'SELECT * FROM actions WHERE id = :id AND tenant_id = :tid',
      { id: actionId, tid: tenantId },
    );
    return rows[0] ?? null;
  },

  /**
   * Records a decision (approve/reject) on a single pending action.
   * Tenant-scoped + status-guarded: only flips rows owned by this tenant that are
   * still 'pending', so a stale or cross-tenant request cannot mutate state.
   * Returns the number of affected rows.
   */
  async decide(tenantId: string, actionId: string, status: 'approved' | 'rejected'): Promise<number> {
    const result = await execute(
      `UPDATE actions
         SET status = :status, decided_at = NOW()
       WHERE id = :id AND tenant_id = :tid AND status = 'pending'`,
      { id: actionId, tid: tenantId, status },
    );
    return result.affectedRows;
  },

  /** Approves every pending action for the tenant. Returns the count approved. */
  async approveAllPending(tenantId: string): Promise<number> {
    const result = await execute(
      `UPDATE actions
         SET status = 'approved', decided_at = NOW()
       WHERE tenant_id = :tid AND status = 'pending'`,
      { tid: tenantId },
    );
    return result.affectedRows;
  },
};
