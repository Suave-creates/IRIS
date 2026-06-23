import type { RowDataPacket } from 'mysql2/promise';
import type { Notification } from '@iris/shared';
import { execute, query } from '../../db/pool.js';

interface NotificationRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  body: string | null;
  dot_color: string;
  is_read: number;
  created_at: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? null,
    dotColor: row.dot_color,
    read: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export const notificationsRepo = {
  /** Latest 20 notifications for a user, scoped to their tenant, newest first. */
  async listRecent(tenantId: string, userId: string): Promise<Notification[]> {
    const rows = await query<NotificationRow[]>(
      `SELECT * FROM notifications
       WHERE tenant_id = :tid AND user_id = :uid
       ORDER BY created_at DESC
       LIMIT 20`,
      { tid: tenantId, uid: userId },
    );
    return rows.map(toNotification);
  },

  /** Marks every unread notification for the caller as read. Returns rows affected. */
  async markAllRead(tenantId: string, userId: string): Promise<number> {
    const result = await execute(
      `UPDATE notifications
       SET is_read = 1
       WHERE tenant_id = :tid AND user_id = :uid AND is_read = 0`,
      { tid: tenantId, uid: userId },
    );
    return result.affectedRows;
  },
};
