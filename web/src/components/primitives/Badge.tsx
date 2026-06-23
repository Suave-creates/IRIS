import type { CSSProperties, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'accent' | 'danger' | 'warn' | 'success' | 'info' | 'violet' | 'neutral';

const TONE_VARS: Record<BadgeTone, { color: string; bg: string }> = {
  accent: { color: 'var(--accent)', bg: 'var(--accent-soft)' },
  danger: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
  warn: { color: 'var(--warn)', bg: 'var(--warn-soft)' },
  success: { color: 'var(--success)', bg: 'var(--success-soft)' },
  info: { color: 'var(--info)', bg: 'var(--info-soft)' },
  violet: { color: 'var(--violet)', bg: 'var(--violet-soft)' },
  neutral: { color: 'var(--text-2)', bg: 'var(--surface-3)' },
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  uppercase?: boolean;
  style?: CSSProperties;
}

/** Pill badge used for statuses, priorities and labels throughout the app. */
export function Badge({ tone = 'neutral', children, uppercase, style }: BadgeProps) {
  const t = TONE_VARS[tone];
  return (
    <span
      className={`${styles.badge} ${uppercase ? styles.uppercase : ''}`}
      style={{ color: t.color, background: t.bg, ...style }}
    >
      {children}
    </span>
  );
}
