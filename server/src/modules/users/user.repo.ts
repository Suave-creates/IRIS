import type { Role } from '@iris/shared';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import {
  DEFAULT_SETTINGS,
  toUserSettings,
  type SettingsRow,
  type UserRow,
  type UserSettings,
} from '../auth/types.js';

export interface CreateUserInput {
  tenantId: string;
  email: string;
  name: string;
  title?: string | null;
  avatarUrl?: string | null;
  role: Role;
  status?: 'active' | 'invited' | 'dormant' | 'disabled';
  googleSub?: string | null;
  passwordHash?: string | null;
}

export const userRepo = {
  async findById(userId: string): Promise<UserRow | null> {
    const rows = await query<UserRow[]>('SELECT * FROM users WHERE id = :id', { id: userId });
    return rows[0] ?? null;
  },

  async findByGoogleSub(sub: string): Promise<UserRow | null> {
    const rows = await query<UserRow[]>('SELECT * FROM users WHERE google_sub = :sub', { sub });
    return rows[0] ?? null;
  },

  async findByTenantAndEmail(tenantId: string, email: string): Promise<UserRow | null> {
    const rows = await query<UserRow[]>(
      'SELECT * FROM users WHERE tenant_id = :tid AND email = :email',
      { tid: tenantId, email },
    );
    return rows[0] ?? null;
  },

  async countByTenant(tenantId: string): Promise<number> {
    const rows = await query<({ n: number } & import('mysql2/promise').RowDataPacket)[]>(
      'SELECT COUNT(*) AS n FROM users WHERE tenant_id = :tid',
      { tid: tenantId },
    );
    return rows[0]?.n ?? 0;
  },

  async listByTenant(tenantId: string): Promise<UserRow[]> {
    return query<UserRow[]>('SELECT * FROM users WHERE tenant_id = :tid ORDER BY created_at', { tid: tenantId });
  },

  async create(input: CreateUserInput): Promise<UserRow> {
    const userId = id('usr');
    await execute(
      `INSERT INTO users (id, tenant_id, email, name, title, avatar_url, role, status, google_sub, password_hash)
       VALUES (:id, :tid, :email, :name, :title, :avatar, :role, :status, :sub, :pwd)`,
      {
        id: userId,
        tid: input.tenantId,
        email: input.email,
        name: input.name,
        title: input.title ?? null,
        avatar: input.avatarUrl ?? null,
        role: input.role,
        status: input.status ?? 'active',
        sub: input.googleSub ?? null,
        pwd: input.passwordHash ?? null,
      },
    );
    const created = await this.findById(userId);
    if (!created) throw new Error('Failed to create user');
    return created;
  },

  async markLogin(userId: string): Promise<void> {
    await execute('UPDATE users SET last_login_at = NOW(), status = IF(status = :invited, :active, status) WHERE id = :id', {
      id: userId,
      invited: 'invited',
      active: 'active',
    });
  },

  async linkGoogleSub(userId: string, sub: string): Promise<void> {
    await execute('UPDATE users SET google_sub = :sub WHERE id = :id', { id: userId, sub });
  },

  async updateProfile(userId: string, patch: { name?: string; avatarUrl?: string | null; title?: string | null }): Promise<void> {
    await execute(
      `UPDATE users SET
         name = COALESCE(:name, name),
         avatar_url = :avatar,
         title = COALESCE(:title, title)
       WHERE id = :id`,
      { id: userId, name: patch.name ?? null, avatar: patch.avatarUrl ?? null, title: patch.title ?? null },
    );
  },

  // ── Settings ──
  async getSettings(userId: string): Promise<UserSettings> {
    const rows = await query<SettingsRow[]>('SELECT * FROM user_settings WHERE user_id = :id', { id: userId });
    return rows[0] ? toUserSettings(rows[0]) : { ...DEFAULT_SETTINGS };
  },

  async upsertSettings(userId: string, tenantId: string, s: UserSettings): Promise<void> {
    await execute(
      `INSERT INTO user_settings
         (user_id, tenant_id, continuous_learning, auto_save_memory, retention_months,
          approve_email, approve_calendar, approve_delete, voice_replies, voice)
       VALUES (:uid, :tid, :cl, :asm, :ret, :ae, :ac, :ad, :vr, :voice)
       ON DUPLICATE KEY UPDATE
         continuous_learning = VALUES(continuous_learning),
         auto_save_memory   = VALUES(auto_save_memory),
         retention_months   = VALUES(retention_months),
         approve_email      = VALUES(approve_email),
         approve_calendar   = VALUES(approve_calendar),
         approve_delete     = VALUES(approve_delete),
         voice_replies      = VALUES(voice_replies),
         voice              = VALUES(voice)`,
      {
        uid: userId,
        tid: tenantId,
        cl: s.continuousLearning ? 1 : 0,
        asm: s.autoSaveMemory ? 1 : 0,
        ret: s.retentionMonths,
        ae: s.approveEmail ? 1 : 0,
        ac: s.approveCalendar ? 1 : 0,
        ad: s.approveDelete ? 1 : 0,
        vr: s.voiceReplies ? 1 : 0,
        voice: s.voice,
      },
    );
  },
};
