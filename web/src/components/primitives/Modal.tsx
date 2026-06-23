import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** Fixed-height dialog (vh-capped) with internal scroll, e.g. the approvals modal. */
  tall?: boolean;
  ariaLabel?: string;
  zIndex?: number;
}

/** Accessible modal: overlay blur, click-outside + Escape to close, body scroll lock. */
export function Modal({ open, onClose, children, width = 480, tall, ariaLabel, zIndex = 60 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} style={{ zIndex }} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`${styles.dialog} ${tall ? styles.tall : ''}`}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
