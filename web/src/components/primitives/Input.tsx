import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import styles from './Input.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[styles.input, invalid ? styles.invalid : '', className ?? ''].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={[styles.input, styles.textarea, invalid ? styles.invalid : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

export interface FieldProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}

/** Labelled form field wrapper. */
export function Field({ label, htmlFor, children, hint, error }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
