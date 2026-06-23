import type { RowDataPacket } from 'mysql2/promise';
import type { KnowledgeGraph, Memory, MemoryType } from '@iris/shared';
import { execute, query } from '../../db/pool.js';

// ── Row shapes (DB snake_case) ────────────────────────────────────────────────
interface MemoryRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  type: MemoryType;
  content: string;
  source: string | null;
  confidence: number | null;
  scope: 'short' | 'long';
  created_at: string;
}

interface KnowledgeNodeRow extends RowDataPacket {
  id: string;
  label: string;
  kind: string;
}

interface KnowledgeEdgeRow extends RowDataPacket {
  from_node: string;
  to_node: string;
  relation: string | null;
}

interface CountRow extends RowDataPacket {
  n: number;
}

export interface MemoryCounts {
  shortTerm: number;
  longTerm: number;
  nodes: number;
  edges: number;
  preferences: number;
}

// ── Mappers (DB → DTO) ────────────────────────────────────────────────────────
function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    scope: row.scope,
    createdAt: row.created_at,
  };
}

export const memoryRepo = {
  /** Aggregate counts across memories + knowledge graph for a tenant. */
  async counts(tenantId: string): Promise<MemoryCounts> {
    const [memRows, nodeRows, edgeRows] = await Promise.all([
      query<CountRow[]>(
        `SELECT
           SUM(scope = :short)        AS short_term,
           SUM(scope = :long)         AS long_term,
           SUM(type = :preference)    AS preferences
         FROM memories WHERE tenant_id = :tid`,
        { tid: tenantId, short: 'short', long: 'long', preference: 'preference' },
      ),
      query<CountRow[]>('SELECT COUNT(*) AS n FROM knowledge_nodes WHERE tenant_id = :tid', { tid: tenantId }),
      query<CountRow[]>('SELECT COUNT(*) AS n FROM knowledge_edges WHERE tenant_id = :tid', { tid: tenantId }),
    ]);

    const agg = memRows[0] as (CountRow & { short_term: number | null; long_term: number | null; preferences: number | null }) | undefined;
    return {
      shortTerm: Number(agg?.short_term ?? 0),
      longTerm: Number(agg?.long_term ?? 0),
      nodes: nodeRows[0]?.n ?? 0,
      edges: edgeRows[0]?.n ?? 0,
      preferences: Number(agg?.preferences ?? 0),
    };
  },

  /** Most recent memories for a tenant (latest first). */
  async recent(tenantId: string, limit: number): Promise<Memory[]> {
    const rows = await query<MemoryRow[]>(
      'SELECT * FROM memories WHERE tenant_id = :tid ORDER BY created_at DESC, id DESC LIMIT :lim',
      { tid: tenantId, lim: limit },
    );
    return rows.map(toMemory);
  },

  /** Knowledge graph (nodes + edges) for a tenant. */
  async graph(tenantId: string): Promise<KnowledgeGraph> {
    const [nodeRows, edgeRows] = await Promise.all([
      query<KnowledgeNodeRow[]>(
        'SELECT id, label, kind FROM knowledge_nodes WHERE tenant_id = :tid ORDER BY created_at, id',
        { tid: tenantId },
      ),
      query<KnowledgeEdgeRow[]>(
        'SELECT from_node, to_node, relation FROM knowledge_edges WHERE tenant_id = :tid ORDER BY id',
        { tid: tenantId },
      ),
    ]);
    return {
      nodes: nodeRows.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
      edges: edgeRows.map((e) => ({ from: e.from_node, to: e.to_node, relation: e.relation })),
    };
  },

  /** Deletes a memory if it belongs to the tenant. Returns true when a row was removed. */
  async deleteForTenant(tenantId: string, memoryId: string): Promise<boolean> {
    const result = await execute('DELETE FROM memories WHERE id = :id AND tenant_id = :tid', {
      id: memoryId,
      tid: tenantId,
    });
    return result.affectedRows > 0;
  },
};
