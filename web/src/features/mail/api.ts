import type { MailItem, MailStats } from '@iris/shared';
import { api } from '@/lib/api';

export interface MailQuery {
  /** Category key from MailStats, or 'all' / undefined for everything. */
  category?: string;
  /** Free-text keyword filter (matches from, subject, summary, tags server-side). */
  q?: string;
  /** Scope = Recent: cap to the N most recent messages. */
  limit?: number;
  /** Scope = Last 7 days: only messages received within the last N days. */
  days?: number;
  /** Scope = Date range: inclusive start/end (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Only messages where I'm tagged in the body. */
  taggedMe?: boolean;
}

function buildQuery({ category, q, limit, days, from, to, taggedMe }: MailQuery): string {
  const params = new URLSearchParams();
  if (category && category !== 'all') params.set('category', category);
  if (q && q.trim()) params.set('q', q.trim());
  if (limit && limit > 0) params.set('limit', String(limit));
  if (days && days > 0) params.set('days', String(days));
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (taggedMe) params.set('taggedMe', '1');
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface MailSyncResult {
  provider: string;
  ok: boolean;
  imported: number;
  detail: string;
  error?: string;
}

export const mailApi = {
  items: (query: MailQuery = {}) => api.get<MailItem[]>(`/mail/items${buildQuery(query)}`),
  stats: () => api.get<MailStats>('/mail/stats'),
  sync: () => api.post<MailSyncResult>('/mail/sync'),
};
