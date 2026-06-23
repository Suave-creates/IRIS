import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  height?: number;
  /** Smooth the width transition (e.g. sync progress). */
  smooth?: boolean;
}

export function ProgressBar({ value, height = 6, smooth = true }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.track} style={{ height }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={styles.fill}
        style={{ width: `${pct}%`, transition: smooth ? 'width .4s ease' : 'none' }}
      />
    </div>
  );
}
