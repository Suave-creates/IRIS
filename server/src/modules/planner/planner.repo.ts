import type { RowDataPacket } from 'mysql2/promise';
import type { PlannerBlock, PlannerBlockInput, UpdatePlannerBlockInput } from '@iris/shared';
import { normalizePlannerColor } from '@iris/shared';
import { execute, query, withTransaction } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

interface PlannerBlockRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  user_id: string;
  block_date: string;
  title: string;
  full_day: number;
  span: number;
  color: string;
  notes: string | null;
  position: number;
}

function toBlock(r: PlannerBlockRow): PlannerBlock {
  return {
    id: r.id,
    date: r.block_date,
    title: r.title,
    fullDay: r.full_day === 1,
    span: r.span > 0 ? r.span : 1,
    color: r.color,
    position: r.position,
    notes: r.notes ?? null,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Adds `n` days to a YYYY-MM-DD string (server-side, for rollover). */
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export const plannerRepo = {
  /**
   * The user's blocks that OVERLAP [from, to] (inclusive). A block covers
   * [block_date, block_date + span − 1], so a multi-day block starting before the
   * window still shows if it reaches into it.
   */
  async listByRange(tenantId: string, userId: string, from: string, to: string): Promise<PlannerBlock[]> {
    const rows = await query<PlannerBlockRow[]>(
      `SELECT * FROM planner_blocks
        WHERE tenant_id = :tid AND user_id = :uid
          AND block_date <= :to
          AND DATE_ADD(block_date, INTERVAL span DAY) > :from
        ORDER BY block_date, position, created_at, id`,
      { tid: tenantId, uid: userId, from, to },
    );
    return rows.map(toBlock);
  },

  async getById(tenantId: string, userId: string, blockId: string): Promise<PlannerBlock | null> {
    const rows = await query<PlannerBlockRow[]>(
      'SELECT * FROM planner_blocks WHERE id = :id AND tenant_id = :tid AND user_id = :uid',
      { id: blockId, tid: tenantId, uid: userId },
    );
    return rows[0] ? toBlock(rows[0]) : null;
  },

  async create(tenantId: string, userId: string, input: PlannerBlockInput): Promise<PlannerBlock> {
    const blockId = id('plb');
    await execute(
      `INSERT INTO planner_blocks (id, tenant_id, user_id, block_date, title, full_day, span, color, notes, position)
       VALUES (:id, :tid, :uid, :date, :title, :full, :span, :color, :notes,
               (SELECT COALESCE(MAX(position)+1,0) FROM planner_blocks pb WHERE pb.tenant_id = :tid AND pb.user_id = :uid AND pb.block_date = :date))`,
      {
        id: blockId, tid: tenantId, uid: userId, date: input.date, title: input.title.slice(0, 255),
        full: input.fullDay ? 1 : 0, span: clampSpan(input.span), color: normalizePlannerColor(input.color),
        notes: input.notes?.slice(0, 2000) || null,
      },
    );
    const created = await this.getById(tenantId, userId, blockId);
    if (!created) throw new Error('Failed to create planner block');
    return created;
  },

  async update(tenantId: string, userId: string, blockId: string, patch: UpdatePlannerBlockInput): Promise<boolean> {
    const r = await execute(
      `UPDATE planner_blocks SET
         block_date = COALESCE(:date, block_date),
         title = COALESCE(:title, title),
         full_day = COALESCE(:full, full_day),
         span = COALESCE(:span, span),
         color = COALESCE(:color, color),
         position = COALESCE(:position, position),
         notes = IF(:notesSet, :notes, notes)
       WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
      {
        id: blockId, tid: tenantId, uid: userId,
        date: patch.date ?? null,
        title: patch.title?.slice(0, 255) ?? null,
        full: patch.fullDay === undefined ? null : patch.fullDay ? 1 : 0,
        span: patch.span === undefined ? null : clampSpan(patch.span),
        color: patch.color ? normalizePlannerColor(patch.color) : null,
        position: patch.position ?? null,
        notesSet: patch.notes !== undefined ? 1 : 0,
        notes: patch.notes?.slice(0, 2000) ?? null,
      },
    );
    return r.affectedRows > 0;
  },

  async remove(tenantId: string, userId: string, blockId: string): Promise<boolean> {
    const r = await execute('DELETE FROM planner_blocks WHERE id = :id AND tenant_id = :tid AND user_id = :uid', {
      id: blockId, tid: tenantId, uid: userId,
    });
    return r.affectedRows > 0;
  },

  /**
   * Reassigns the given blocks to `date` in the given order (positions 0..n).
   * Handles both within-day reorder and moving a block onto another day (drag).
   * Only the user's own blocks are touched.
   */
  async reorderForDay(tenantId: string, userId: string, date: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await withTransaction(async (conn) => {
      for (let i = 0; i < ids.length; i++) {
        await conn.execute(
          `UPDATE planner_blocks SET block_date = :date, position = :pos
            WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
          { date, pos: i, id: ids[i], tid: tenantId, uid: userId } as never,
        );
      }
    });
  },

  /**
   * Copies every block in the week [weekStart, weekStart+6] forward by 7 days.
   * Returns how many blocks were copied.
   */
  async rolloverWeek(tenantId: string, userId: string, weekStart: string): Promise<number> {
    const weekEnd = addDaysYmd(weekStart, 6);
    const rows = await query<PlannerBlockRow[]>(
      `SELECT * FROM planner_blocks
        WHERE tenant_id = :tid AND user_id = :uid AND block_date BETWEEN :from AND :to
        ORDER BY block_date, position, id`,
      { tid: tenantId, uid: userId, from: weekStart, to: weekEnd },
    );
    if (rows.length === 0) return 0;
    await withTransaction(async (conn) => {
      for (const b of rows) {
        await conn.execute(
          `INSERT INTO planner_blocks (id, tenant_id, user_id, block_date, title, full_day, span, color, notes, position)
           VALUES (:id, :tid, :uid, :date, :title, :full, :span, :color, :notes, :pos)`,
          {
            id: id('plb'), tid: tenantId, uid: userId, date: addDaysYmd(b.block_date, 7), title: b.title,
            full: b.full_day, span: b.span > 0 ? b.span : 1, color: b.color, notes: b.notes, pos: b.position,
          } as never,
        );
      }
    });
    return rows.length;
  },
};

/** Clamp a span to a sane 1–31 range. */
function clampSpan(span: number | undefined): number {
  if (!span || !Number.isFinite(span)) return 1;
  return Math.max(1, Math.min(31, Math.floor(span)));
}
