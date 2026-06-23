import type { RowDataPacket } from 'mysql2/promise';
import type { Connector, ConnectorProvider, ConnectorStatus } from '@iris/shared';
import { query } from '../../db/pool.js';

/** Raw `connectors` row as returned by MySQL (snake_case, dateStrings). */
export interface ConnectorRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  provider: ConnectorProvider;
  display_name: string;
  group_label: string;
  status: ConnectorStatus;
  capabilities: string | null;
  last_synced_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Maps a DB row to the public Connector DTO (snake_case → camelCase). */
export function toConnector(row: ConnectorRow): Connector {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    groupLabel: row.group_label,
    status: row.status,
    capabilities: row.capabilities,
    lastSyncedAt: row.last_synced_at,
    note: row.note,
  };
}

export const connectorRepo = {
  /** Every connector for the given tenant, stable order for the UI. */
  async listByTenant(tenantId: string): Promise<Connector[]> {
    const rows = await query<ConnectorRow[]>(
      `SELECT * FROM connectors
        WHERE tenant_id = :tid
        ORDER BY group_label, display_name`,
      { tid: tenantId },
    );
    return rows.map(toConnector);
  },
};
