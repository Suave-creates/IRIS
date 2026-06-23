import type { SessionUser } from '@iris/shared';
import { api } from '@/lib/api';

export interface AuthProviders {
  google: boolean;
  password: boolean;
}

export const authApi = {
  session: () => api.get<{ user: SessionUser | null }>('/auth/session'),
  providers: () => api.get<AuthProviders>('/auth/providers'),
  login: (email: string, password: string) =>
    api.post<{ user: SessionUser }>('/auth/login', { email, password }),
  register: (name: string, email: string, password: string) =>
    api.post<{ user: SessionUser }>('/auth/register', { name, email, password }),
  logout: () => api.post<{ ok: boolean }>('/auth/logout'),
};

/** Full-page redirect into the Google SSO flow (server sets the PKCE/state cookie). */
export function startGoogleSignIn(): void {
  window.location.href = '/api/auth/google/start';
}
