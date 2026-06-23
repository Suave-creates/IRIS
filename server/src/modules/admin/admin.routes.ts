import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { AdminAuditEntry, AdminOverview, AdminUser } from '@iris/shared';
import { pingDb, query } from '../../db/pool.js';
import { currentUser, requireAuth, requireRole } from '../auth/guards.js';
import { auditService } from '../audit/audit.service.js';
import { userRepo } from '../users/user.repo.js';

/** Single-column COUNT(*) result row. */
interface CountRow extends RowDataPacket {
  n: number;
}

/** Counts rows in a tenant-scoped table, optionally constrained to a status. */
async function countByTenant(table: string, tenantId: string, status?: string): Promise<number> {
  const sql =
    status === undefined
      ? `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = :tid`
      : `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = :tid AND status = :status`;
  const rows = await query<CountRow[]>(sql, { tid: tenantId, status: status ?? null });
  return rows[0]?.n ?? 0;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('owner', 'admin'));

  app.get('/overview', async (req) => {
    const { tenantId } = currentUser(req);

    const [users, connectorCount, memoryCount, pendingApprovals, dbOk, auditRows] =
      await Promise.all([
        userRepo.listByTenant(tenantId),
        countByTenant('connectors', tenantId),
        countByTenant('memories', tenantId),
        countByTenant('actions', tenantId, 'pending'),
        pingDb().catch(() => false),
        auditService.listForTenant(tenantId, 10),
      ]);

    const activeUsers = users.filter((u) => u.status === 'active').length;

    const adminUsers: AdminUser[] = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      connectorCount,
    }));

    const audit: AdminAuditEntry[] = auditRows.map((row) => ({
      id: row.id,
      time: row.created_at,
      action: row.action,
      actor: row.actor_user_id ?? null,
    }));

    const data: AdminOverview = {
      stats: {
        activeUsers,
        connectors: connectorCount,
        memories: memoryCount,
        pendingApprovals,
      },
      users: adminUsers,
      systemHealth: [
        { name: 'Database', status: dbOk ? 'operational' : 'down' },
        { name: 'API gateway', status: 'operational' },
        { name: 'Context engine', status: 'operational' },
        { name: 'Worker pool', status: 'operational' },
        { name: 'Connector sync', status: 'operational' },
      ],
      audit,
    };

    return { data };
  });
}
