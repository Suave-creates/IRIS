import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

/** Accessible switch matching the prototype's pill toggles. */
export function Toggle({ checked, onChange, label, disabled, size = 'md' }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.track} ${styles[size]} ${checked ? styles.on : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  );
}
