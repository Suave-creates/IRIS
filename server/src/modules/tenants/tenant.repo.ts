import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import type { TenantRow } from '../auth/types.js';

const DEFAULT_ACCENT = '#4b49d6';

export const tenantRepo = {
  async findById(tenantId: string): Promise<TenantRow | null> {
    const rows = await query<TenantRow[]>('SELECT * FROM tenants WHERE id = :id', { id: tenantId });
    return rows[0] ?? null;
  },

  async findByDomain(domain: string): Promise<TenantRow | null> {
    const rows = await query<TenantRow[]>('SELECT * FROM tenants WHERE primary_domain = :domain', { domain });
    return rows[0] ?? null;
  },

  async create(input: { name: string; primaryDomain: string | null; accentColor?: string }): Promise<TenantRow> {
    const tenantId = id('ten');
    await execute(
      `INSERT INTO tenants (id, name, primary_domain, accent_color)
       VALUES (:id, :name, :domain, :accent)`,
      {
        id: tenantId,
        name: input.name,
        domain: input.primaryDomain,
        accent: input.accentColor ?? DEFAULT_ACCENT,
      },
    );
    const created = await this.findById(tenantId);
    if (!created) throw new Error('Failed to create tenant');
    return created;
  },
};
