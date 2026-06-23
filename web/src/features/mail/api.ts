import type { MailItem, MailStats } from '@iris/shared';
import { api } from '@/lib/api';

export interface MailQuery {
  /** Category key from MailStats, or 'all' / undefined for everything. */
  category?: string;
  /** Free-text keyword filter (matches from, subject, summary, tags server-side). */
  q?: string;
}

function buildQuery({ category, q }: MailQuery): string {
  const params = new URLSearchParams();
  if (category && category !== 'all') params.set('category', category);
  if (q && q.trim()) params.set('q', q.trim());
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const mailApi = {
  items: (query: MailQuery = {}) => api.get<MailItem[]>(`/mail/items${buildQuery(query)}`),
  stats: () => api.get<MailStats>('/mail/stats'),
};
