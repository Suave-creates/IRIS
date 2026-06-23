import type { RowDataPacket } from 'mysql2/promise';
import type { JournalTask, TaskPriority } from '@iris/shared';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

/** Raw `journal_tasks` row as it comes back from MySQL (dateStrings on). */
export interface JournalTaskRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  priority: TaskPriority;
  done: number;
  detail: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields a caller may write when creating/updating a journal task. */
export interface JournalTaskWrite {
  title: string;
  dueDate: string;
  dueTime?: string | null;
  priority: TaskPriority;
  done?: boolean;
  detail?: string | null;
}

/** Maps a DB row → the shared JournalTask DTO (snake_case → camelCase). */
function toJournalTask(row: JournalTaskRow): JournalTask {
  return {
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    dueTime: row.due_time ?? null,
    priority: row.priority,
    done: row.done === 1,
    detail: row.detail ?? null,
  };
}

export const journalRepo = {
  /**
   * Lists the caller's own tasks within [from, to] (inclusive), ordered by
   * due_date then due_time. Tenant- and user-scoped.
   */
  async listForUser(
    tenantId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<JournalTask[]> {
    const rows = await query<JournalTaskRow[]>(
      `SELECT * FROM journal_tasks
        WHERE tenant_id = :tid AND user_id = :uid
          AND due_date BETWEEN :from AND :to
        ORDER BY due_date, due_time IS NULL, due_time`,
      { tid: tenantId, uid: userId, from, to },
    );
    return rows.map(toJournalTask);
  },

  /** Fetches one task scoped to tenant + owning user, or null. */
  async findOwned(
    tenantId: string,
    userId: string,
    taskId: string,
  ): Promise<JournalTask | null> {
    const rows = await query<JournalTaskRow[]>(
      `SELECT * FROM journal_tasks
        WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
      { id: taskId, tid: tenantId, uid: userId },
    );
    return rows[0] ? toJournalTask(rows[0]) : null;
  },

  /** Creates a task owned by the caller and returns the persisted DTO. */
  async create(
    tenantId: string,
    userId: string,
    input: JournalTaskWrite,
  ): Promise<JournalTask> {
    const taskId = id('jtsk');
    await execute(
      `INSERT INTO journal_tasks
         (id, tenant_id, user_id, title, due_date, due_time, priority, done, detail)
       VALUES (:id, :tid, :uid, :title, :due, :time, :prio, :done, :detail)`,
      {
        id: taskId,
        tid: tenantId,
        uid: userId,
        title: input.title,
        due: input.dueDate,
        time: input.dueTime ?? null,
        prio: input.priority,
        done: input.done ? 1 : 0,
        detail: input.detail ?? null,
      },
    );
    const created = await this.findOwned(tenantId, userId, taskId);
    if (!created) throw new Error('Failed to create journal task');
    return created;
  },

  /**
   * Updates a task the caller owns. The WHERE clause re-asserts tenant + user
   * so another tenant's row can never be touched. Returns the row, or null if
   * no owned row matched.
   */
  async update(
    tenantId: string,
    userId: string,
    taskId: string,
    input: JournalTaskWrite,
  ): Promise<JournalTask | null> {
    const result = await execute(
      `UPDATE journal_tasks SET
         title = :title,
         due_date = :due,
         due_time = :time,
         priority = :prio,
         done = :done,
         detail = :detail
       WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
      {
        id: taskId,
        tid: tenantId,
        uid: userId,
        title: input.title,
        due: input.dueDate,
        time: input.dueTime ?? null,
        prio: input.priority,
        done: input.done ? 1 : 0,
        detail: input.detail ?? null,
      },
    );
    if (result.affectedRows === 0) return null;
    return this.findOwned(tenantId, userId, taskId);
  },

  /** Deletes a task the caller owns. Returns true if a row was removed. */
  async remove(tenantId: string, userId: string, taskId: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM journal_tasks
        WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
      { id: taskId, tid: tenantId, uid: userId },
    );
    return result.affectedRows > 0;
  },
};
