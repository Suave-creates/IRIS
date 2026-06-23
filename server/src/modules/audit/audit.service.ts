import type { RowDataPacket } from 'mysql2/promise';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  logRef?: string | null;
}

export interface AuditRow extends RowDataPacket {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  ip: string | null;
  log_ref: string | null;
  created_at: string;
}

export const auditService = {
  /** Records an audit entry. Never throws into the request path — logs on failure. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await execute(
        `INSERT INTO audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, metadata, ip, log_ref)
         VALUES (:id, :tid, :actor, :action, :ttype, :tid2, :meta, :ip, :ref)`,
        {
          id: id('aud'),
          tid: entry.tenantId ?? null,
          actor: entry.actorUserId ?? null,
          action: entry.action,
          ttype: entry.targetType ?? null,
          tid2: entry.targetId ?? null,
          meta: entry.metadata ? JSON.stringify(entry.metadata) : null,
          ip: entry.ip ?? null,
          ref: entry.logRef ?? null,
        },
      );
    } catch (err) {
      logger.error({ err, action: entry.action }, 'failed to write audit entry');
    }
  },

  async listForTenant(tenantId: string, limit = 50): Promise<AuditRow[]> {
    return query<AuditRow[]>(
      'SELECT * FROM audit_log WHERE tenant_id = :tid ORDER BY created_at DESC LIMIT :lim',
      { tid: tenantId, lim: limit },
    );
  },
};
