import type { RowDataPacket } from 'mysql2/promise';
import type { WhiteboardItem, WhiteboardKind } from '@iris/shared';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

interface WhiteboardRow extends RowDataPacket {
  id: string;
  kind: WhiteboardKind;
  title: string;
  external_id: string | null;
  web_link: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  ai_included: number;
  body: string | null;
  created_at: string;
}

function toItem(r: WhiteboardRow): WhiteboardItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    externalId: r.external_id,
    webLink: r.web_link,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z: r.z,
    aiIncluded: r.ai_included === 1,
    body: r.body,
    createdAt: r.created_at,
  };
}

interface NewItem {
  kind: WhiteboardKind;
  title: string;
  externalId: string | null;
  webLink: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  aiIncluded: boolean;
  body: string | null;
}

export const whiteboardRepo = {
  /** The user's full canvas, bottom-to-top. */
  async list(tenantId: string, userId: string): Promise<WhiteboardItem[]> {
    const rows = await query<WhiteboardRow[]>(
      'SELECT * FROM whiteboard_items WHERE tenant_id = :tid AND user_id = :uid ORDER BY z, created_at',
      { tid: tenantId, uid: userId },
    );
    return rows.map(toItem);
  },

  /** Highest z-index currently on the user's canvas (0 if empty). */
  async maxZ(tenantId: string, userId: string): Promise<number> {
    const rows = await query<(RowDataPacket & { z: number | null })[]>(
      'SELECT MAX(z) AS z FROM whiteboard_items WHERE tenant_id = :tid AND user_id = :uid',
      { tid: tenantId, uid: userId },
    );
    return rows[0]?.z ?? 0;
  },

  async create(tenantId: string, userId: string, input: NewItem): Promise<WhiteboardItem> {
    const itemId = id('wbitm');
    const z = (await this.maxZ(tenantId, userId)) + 1;
    await execute(
      `INSERT INTO whiteboard_items
         (id, tenant_id, user_id, kind, title, external_id, web_link, x, y, w, h, z, ai_included, body)
       VALUES
         (:id, :tid, :uid, :kind, :title, :ext, :link, :x, :y, :w, :h, :z, :ai, :body)`,
      {
        id: itemId,
        tid: tenantId,
        uid: userId,
        kind: input.kind,
        title: input.title.slice(0, 255),
        ext: input.externalId,
        link: input.webLink,
        x: input.x,
        y: input.y,
        w: input.w,
        h: input.h,
        z,
        ai: input.aiIncluded ? 1 : 0,
        body: input.body,
      },
    );
    const created = await this.findById(tenantId, userId, itemId);
    if (!created) throw new Error('Failed to create whiteboard item');
    return created;
  },

  async findById(tenantId: string, userId: string, itemId: string): Promise<WhiteboardItem | null> {
    const rows = await query<WhiteboardRow[]>(
      'SELECT * FROM whiteboard_items WHERE id = :id AND tenant_id = :tid AND user_id = :uid',
      { id: itemId, tid: tenantId, uid: userId },
    );
    return rows[0] ? toItem(rows[0]) : null;
  },

  /** Applies a partial position/size/flag/title update; returns the refreshed row. */
  async update(
    tenantId: string,
    userId: string,
    itemId: string,
    patch: { x?: number; y?: number; w?: number; h?: number; z?: number; aiIncluded?: boolean; title?: string },
  ): Promise<WhiteboardItem | null> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id: itemId, tid: tenantId, uid: userId };
    const map: Record<string, string> = { x: 'x', y: 'y', w: 'w', h: 'h', z: 'z' };
    for (const key of ['x', 'y', 'w', 'h', 'z'] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${map[key]} = :${key}`);
        params[key] = patch[key];
      }
    }
    if (patch.aiIncluded !== undefined) {
      sets.push('ai_included = :ai');
      params.ai = patch.aiIncluded ? 1 : 0;
    }
    if (patch.title !== undefined) {
      sets.push('title = :title');
      params.title = patch.title.slice(0, 255);
    }
    if (sets.length === 0) return this.findById(tenantId, userId, itemId);

    const res = await execute(
      `UPDATE whiteboard_items SET ${sets.join(', ')} WHERE id = :id AND tenant_id = :tid AND user_id = :uid`,
      params,
    );
    if (res.affectedRows === 0) return null;
    return this.findById(tenantId, userId, itemId);
  },

  async remove(tenantId: string, userId: string, itemId: string): Promise<boolean> {
    const res = await execute(
      'DELETE FROM whiteboard_items WHERE id = :id AND tenant_id = :tid AND user_id = :uid',
      { id: itemId, tid: tenantId, uid: userId },
    );
    return res.affectedRows > 0;
  },
};
