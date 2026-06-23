import type { Role } from '@iris/shared';
import { env } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { seedTenantDemoData } from '../../db/demo-data.js';
import { tenantRepo } from '../tenants/tenant.repo.js';
import { userRepo } from '../users/user.repo.js';
import type { GoogleProfile } from './google.js';
import type { UserRow } from './types.js';

/** Populate a brand-new tenant with demo data so the workspace isn't empty. Never blocks sign-in. */
async function seedNewTenant(user: UserRow): Promise<void> {
  try {
    await seedTenantDemoData(user.tenant_id, user.id, user.name);
  } catch (err) {
    logger.error({ err, tenantId: user.tenant_id }, 'demo seed on tenant creation failed (non-fatal)');
  }
}

function domainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

function assertDomainAllowed(domain: string): void {
  const allowed = env.AUTH_ALLOWED_DOMAINS.map((d) => d.toLowerCase());
  // `domain` is already lowercased by domainOf(); compare case-insensitively.
  if (allowed.length > 0 && !allowed.includes(domain.toLowerCase())) {
    throw Errors.forbidden(`Sign-in is restricted to: ${env.AUTH_ALLOWED_DOMAINS.join(', ')}.`);
  }
}

/** Finds the tenant for an email domain, creating it on first use. */
async function resolveTenant(domain: string): Promise<{ tenantId: string; created: boolean }> {
  const existing = await tenantRepo.findByDomain(domain);
  if (existing) return { tenantId: existing.id, created: false };
  const name = domain ? domain.split('.')[0]!.replace(/^\w/, (c) => c.toUpperCase()) : 'Workspace';
  const tenant = await tenantRepo.create({ name, primaryDomain: domain || null });
  return { tenantId: tenant.id, created: true };
}

/**
 * Only the user who *creates* a tenant becomes its owner. Everyone joining an
 * existing tenant is a member by default (an owner/admin can elevate later).
 * This prevents owner escalation on a pre-existing-but-empty tenant.
 */
function roleForNewUser(tenantCreated: boolean): Role {
  return tenantCreated ? 'owner' : 'member';
}

export const authService = {
  /** Provisions (or updates) a user from a verified Google profile. */
  async provisionFromGoogle(profile: GoogleProfile): Promise<UserRow> {
    // Never trust an unverified Google email — it gates tenant routing and the
    // linking of a Google identity to an existing/invited account.
    if (!profile.emailVerified) {
      throw Errors.forbidden('Your Google email address is not verified.');
    }
    const domain = domainOf(profile.email);
    assertDomainAllowed(domain);

    const bySub = await userRepo.findByGoogleSub(profile.sub);
    if (bySub) {
      if (bySub.status === 'disabled') throw Errors.forbidden('This account has been disabled.');
      await userRepo.updateProfile(bySub.id, { name: profile.name, avatarUrl: profile.picture });
      await userRepo.markLogin(bySub.id);
      return (await userRepo.findById(bySub.id))!;
    }

    const { tenantId, created } = await resolveTenant(domain);

    // A pre-provisioned/invited user with this email — link their Google identity.
    const byEmail = await userRepo.findByTenantAndEmail(tenantId, profile.email);
    if (byEmail) {
      if (byEmail.status === 'disabled') throw Errors.forbidden('This account has been disabled.');
      await userRepo.linkGoogleSub(byEmail.id, profile.sub);
      await userRepo.updateProfile(byEmail.id, { name: profile.name, avatarUrl: profile.picture });
      await userRepo.markLogin(byEmail.id);
      return (await userRepo.findById(byEmail.id))!;
    }

    const role = roleForNewUser(created);
    const user = await userRepo.create({
      tenantId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      role,
      status: 'active',
      googleSub: profile.sub,
    });
    await userRepo.markLogin(user.id);
    if (created) await seedNewTenant(user);
    return user;
  },

  /** Password sign-up (only when AUTH_PASSWORD_ENABLED). */
  async registerWithPassword(input: { email: string; name: string; password: string }): Promise<UserRow> {
    if (!env.AUTH_PASSWORD_ENABLED) throw Errors.forbidden('Password sign-up is disabled.');
    const email = input.email.toLowerCase();
    const domain = domainOf(email);
    assertDomainAllowed(domain);
    const { tenantId, created } = await resolveTenant(domain);
    if (await userRepo.findByTenantAndEmail(tenantId, email)) {
      throw Errors.conflict('An account with this email already exists.');
    }
    const role = roleForNewUser(created);
    const passwordHash = await hashPassword(input.password);
    const user = await userRepo.create({ tenantId, email, name: input.name, role, status: 'active', passwordHash });
    await userRepo.markLogin(user.id);
    if (created) await seedNewTenant(user);
    return user;
  },

  /** Password sign-in (only when AUTH_PASSWORD_ENABLED). Tenant-scoped by domain. */
  async loginWithPassword(input: { email: string; password: string }): Promise<UserRow> {
    if (!env.AUTH_PASSWORD_ENABLED) throw Errors.forbidden('Password sign-in is disabled.');
    const email = input.email.toLowerCase();
    const invalid = Errors.unauthorized('Incorrect email or password.');

    // Resolve the user within their domain's tenant (email is unique per tenant,
    // not globally) — never a tenant-blind lookup.
    const tenant = await tenantRepo.findByDomain(domainOf(email));
    const user = tenant ? await userRepo.findByTenantAndEmail(tenant.id, email) : null;
    if (!user || !user.password_hash) throw invalid;
    if (user.status === 'disabled') throw Errors.forbidden('This account has been disabled.');
    if (!(await verifyPassword(input.password, user.password_hash))) throw invalid;
    await userRepo.markLogin(user.id);
    return user;
  },
};
