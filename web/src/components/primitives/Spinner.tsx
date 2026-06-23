export interface SpinnerProps {
  size?: number;
  strokeWidth?: number;
  color?: string;
}

/** Indeterminate spinner (the open arc from the prototype) using irisSpin. */
export function Spinner({ size = 17, strokeWidth = 2.2, color = 'var(--accent)' }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      role="status"
      aria-label="Loading"
      style={{ transformOrigin: 'center', animation: 'irisSpin .9s linear infinite' }}
    >
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    </svg>
  );
}
