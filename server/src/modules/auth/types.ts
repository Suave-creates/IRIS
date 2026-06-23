import type { RowDataPacket } from 'mysql2/promise';
import type { Role, SessionUser } from '@iris/shared';

export interface UserRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  title: string | null;
  avatar_url: string | null;
  role: Role;
  status: 'active' | 'invited' | 'dormant' | 'disabled';
  google_sub: string | null;
  password_hash: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantRow extends RowDataPacket {
  id: string;
  name: string;
  primary_domain: string | null;
  accent_color: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  tenant_id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface SettingsRow extends RowDataPacket {
  user_id: string;
  tenant_id: string;
  continuous_learning: number;
  auto_save_memory: number;
  retention_months: number;
  approve_email: number;
  approve_calendar: number;
  approve_delete: number;
  voice_replies: number;
  voice: string;
  updated_at: string;
}

/** Maps a user row to the client-facing session principal. */
export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    tenantId: u.tenant_id,
    email: u.email,
    name: u.name,
    title: u.title,
    avatarUrl: u.avatar_url,
    role: u.role,
  };
}

export interface UserSettings {
  continuousLearning: boolean;
  autoSaveMemory: boolean;
  retentionMonths: number;
  approveEmail: boolean;
  approveCalendar: boolean;
  approveDelete: boolean;
  voiceReplies: boolean;
  voice: string;
}

export function toUserSettings(r: SettingsRow): UserSettings {
  return {
    continuousLearning: !!r.continuous_learning,
    autoSaveMemory: !!r.auto_save_memory,
    retentionMonths: r.retention_months,
    approveEmail: !!r.approve_email,
    approveCalendar: !!r.approve_calendar,
    approveDelete: !!r.approve_delete,
    voiceReplies: !!r.voice_replies,
    voice: r.voice,
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  continuousLearning: true,
  autoSaveMemory: false,
  retentionMonths: 24,
  approveEmail: true,
  approveCalendar: true,
  approveDelete: true,
  voiceReplies: false,
  voice: 'Calm · Neutral',
};
