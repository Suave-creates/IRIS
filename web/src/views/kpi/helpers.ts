import type { KpiTrend } from '@iris/shared';

// Reuse the Projects meta (priority pill, source dot/label, status colour) verbatim.
export { PRIORITY_META, SOURCE_META, statusColor } from '../projects/helpers';

export interface TrendMeta {
  arrow: string;
  label: string;
  color: string;
}
/** Trend arrow / word / colour per KPI trend. */
export const TREND_META: Record<KpiTrend, TrendMeta> = {
  up: { arrow: '↑', label: 'Up', color: 'var(--success)' },
  down: { arrow: '↓', label: 'Down', color: 'var(--danger)' },
  flat: { arrow: '→', label: 'Flat', color: 'var(--text-3)' },
};

/** Attainment bar colour by how close to target (0–100). */
export function attainmentColor(pct: number): string {
  if (pct >= 90) return 'var(--success)';
  if (pct >= 70) return 'var(--warn)';
  if (pct <= 0) return 'var(--text-3)';
  return 'var(--danger)';
}
