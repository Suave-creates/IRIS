import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
  variant?: 'bordered' | 'plain';
  children: ReactNode;
}

/** Square, accessible icon-only button (header controls, card affordances). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 34, variant = 'bordered', className, children, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={[styles.btn, styles[variant], className ?? ''].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});
