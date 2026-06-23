import type { RowDataPacket } from 'mysql2/promise';
import type { MailItem, MailStats } from '@iris/shared';
import { query } from '../../db/pool.js';

/** Raw row shape for the mail_items table. DATE/JSON come back as strings (dateStrings). */
interface MailItemRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  from_name: string;
  subject: string;
  summary: string | null;
  category: string;
  priority: 'high' | 'med' | 'low';
  received_at: string;
  tags: string | null;
}

interface CategoryCountRow extends RowDataPacket {
  category: string;
  count: number;
}

interface CountRow extends RowDataPacket {
  n: number;
}

/** Parses a JSON tags column defensively into a string[]. */
function parseTags(raw: unknown): string[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.map((t) => String(t)) : [];
}

/** Maps a DB row (snake_case) to the MailItem DTO (camelCase). */
function toMailItem(row: MailItemRow): MailItem {
  return {
    id: row.id,
    fromName: row.from_name,
    subject: row.subject,
    summary: row.summary,
    category: row.category,
    priority: row.priority,
    receivedAt: row.received_at,
    tags: parseTags(row.tags),
  };
}

export interface ListMailFilter {
  /** Category to filter by; omit (or 'all') for every category. */
  category?: string;
  /** Case-insensitive keyword matched against subject/summary/from_name/tags. */
  q?: string;
}

export const mailRepo = {
  /**
   * Lists tenant-scoped mail items, optionally filtered by category and/or a
   * keyword (matched against subject, summary, from_name, and the tags JSON).
   * Ordered by received_at DESC.
   */
  async listByTenant(tenantId: string, filter: ListMailFilter = {}): Promise<MailItem[]> {
    const params: Record<string, unknown> = { tid: tenantId };
    let sql = 'SELECT * FROM mail_items WHERE tenant_id = :tid';

    if (filter.category && filter.category !== 'all') {
      sql += ' AND category = :category';
      params.category = filter.category;
    }

    const keyword = filter.q?.trim();
    if (keyword) {
      // Case-insensitive substring match across the text fields and the JSON tags.
      // The table collation is utf8mb4_unicode_ci, so LIKE is already case-insensitive.
      sql +=
        ' AND (subject LIKE :kw OR summary LIKE :kw OR from_name LIKE :kw OR CAST(tags AS CHAR) LIKE :kw)';
      params.kw = `%${escapeLike(keyword)}%`;
    }

    sql += ' ORDER BY received_at DESC';

    const rows = await query<MailItemRow[]>(sql, params);
    return rows.map(toMailItem);
  },

  /**
   * Returns mail intelligence stats for the tenant: total indexed count plus a
   * per-category breakdown.
   */
  async statsByTenant(tenantId: string): Promise<MailStats> {
    const [totalRows, categoryRows] = await Promise.all([
      query<CountRow[]>('SELECT COUNT(*) AS n FROM mail_items WHERE tenant_id = :tid', {
        tid: tenantId,
      }),
      query<CategoryCountRow[]>(
        `SELECT category, COUNT(*) AS count
           FROM mail_items
          WHERE tenant_id = :tid
          GROUP BY category
          ORDER BY count DESC, category ASC`,
        { tid: tenantId },
      ),
    ]);

    return {
      indexed: totalRows[0]?.n ?? 0,
      categories: categoryRows.map((r) => ({ key: r.category, count: Number(r.count) })),
    };
  },
};

/** Escapes LIKE wildcards in user input so they are matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
