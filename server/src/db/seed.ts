/**
 * Idempotent dev seed. Creates a demo tenant + owner so the app is usable
 * locally — particularly for password sign-in (set AUTH_PASSWORD_ENABLED=true).
 *
 *   npm run db:seed
 *
 * Google SSO does NOT need this: it provisions tenants/users on first sign-in.
 */
import { env } from '../config/env.js';
import { hashPassword } from '../lib/crypto.js';
import { tenantRepo } from '../modules/tenants/tenant.repo.js';
import { userRepo } from '../modules/users/user.repo.js';
import { DEFAULT_SETTINGS } from '../modules/auth/types.js';
import { closePool } from './pool.js';

async function seed(): Promise<void> {
  const email = env.SEED_OWNER_EMAIL.toLowerCase();
  const domain = email.split('@')[1] ?? 'demo.local';

  let tenant = await tenantRepo.findByDomain(domain);
  if (!tenant) {
    tenant = await tenantRepo.create({ name: env.SEED_TENANT_NAME, primaryDomain: domain });
    console.log(`▸ created tenant "${tenant.name}" (${tenant.id})`);
  } else {
    console.log(`· tenant "${tenant.name}" already exists`);
  }

  let owner = await userRepo.findByTenantAndEmail(tenant.id, email);
  if (!owner) {
    const passwordHash = env.AUTH_PASSWORD_ENABLED ? await hashPassword(env.SEED_OWNER_PASSWORD) : null;
    owner = await userRepo.create({
      tenantId: tenant.id,
      email,
      name: env.SEED_OWNER_NAME,
      title: 'Owner',
      role: 'owner',
      status: 'active',
      passwordHash,
    });
    console.log(`▸ created owner ${email} (${owner.id})`);
  } else {
    console.log(`· owner ${email} already exists`);
  }

  await userRepo.upsertSettings(owner.id, tenant.id, DEFAULT_SETTINGS);

  console.log('\n✓ seed complete');
  if (env.AUTH_PASSWORD_ENABLED) {
    console.log(`  Sign in with: ${email} / ${env.SEED_OWNER_PASSWORD}`);
  } else {
    console.log('  Password auth is disabled — sign in via Google SSO (AUTH_PASSWORD_ENABLED=true to enable password login).');
  }
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    await closePool();
    process.exit(1);
  });
