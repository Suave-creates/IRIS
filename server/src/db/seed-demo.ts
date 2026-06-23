/**
 * Seeds demo data into every tenant that doesn't have any yet (idempotent).
 * Useful for an already-provisioned tenant created before demo data existed.
 *
 *   npm run db:seed:demo
 */
import type { RowDataPacket } from 'mysql2/promise';
import { query } from './pool.js';
import { closePool } from './pool.js';
import { seedTenantDemoData, tenantHasDemoData } from './demo-data.js';

interface TenantOwner extends RowDataPacket {
  tenant_id: string;
  name: string;
  user_id: string;
}

async function run(): Promise<void> {
  const tenants = await query<({ id: string; name: string } & RowDataPacket)[]>('SELECT id, name FROM tenants');
  if (tenants.length === 0) {
    console.log('No tenants found. Sign in once (creating a tenant), then re-run.');
    return;
  }
  let seeded = 0;
  for (const t of tenants) {
    if (await tenantHasDemoData(t.id)) {
      console.log(`· ${t.name} already has data — skipping`);
      continue;
    }
    // Prefer the owner; fall back to any user in the tenant.
    const owners = await query<TenantOwner[]>(
      `SELECT id AS user_id, name FROM users WHERE tenant_id = :t ORDER BY (role = 'owner') DESC, created_at LIMIT 1`,
      { t: t.id },
    );
    const owner = owners[0];
    if (!owner) {
      console.log(`· ${t.name} has no users — skipping`);
      continue;
    }
    await seedTenantDemoData(t.id, owner.user_id, owner.name);
    console.log(`▸ seeded demo data into "${t.name}"`);
    seeded++;
  }
  console.log(`\n✓ done (${seeded} tenant(s) seeded)`);
}

run()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Demo seed failed:', err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
