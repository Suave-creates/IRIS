import type { SessionUser } from '@iris/shared';
import { api } from '@/lib/api';

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

export interface TenantInfo {
  id: string;
  name: string;
  accentColor: string;
}

export interface MeBundle {
  user: SessionUser;
  tenant: TenantInfo | null;
  settings: UserSettings;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

export const meApi = {
  profile: () => api.get<MeBundle>('/me'),
  updateSettings: (settings: UserSettings) => api.put<UserSettings>('/me/settings', settings),
  sessions: () => api.get<SessionInfo[]>('/me/sessions'),
  revokeOthers: () => api.delete<{ revoked: number }>('/me/sessions'),
};
