import { forwardRef, type HTMLAttributes } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Apply the standard card padding (var(--cardpad)). Default true. */
  padded?: boolean;
  /** Add hover elevation (for interactive cards). */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padded = true, interactive, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[styles.card, padded ? styles.padded : '', interactive ? styles.interactive : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
});
