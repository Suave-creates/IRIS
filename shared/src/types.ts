import type { Role } from './constants.js';

/**
 * Canonical error body returned by every API endpoint on failure.
 * Mirrors the design's error-handling requirements: meaningful message,
 * recovery suggestion, retryability and a log reference for support.
 */
export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. `AUTH_REQUIRED`, `VALIDATION_FAILED`. */
    code: string;
    /** Human-readable message safe to show the user (never a raw exception). */
    message: string;
    /** Optional recovery hint, e.g. "Reconnect Google and try again." */
    recovery?: string;
    /** Whether the client may retry the same request. */
    retryable: boolean;
    /** Correlation id the user can quote to support; ties to server logs. */
    logRef: string;
    /** Field-level validation details, when applicable. */
    details?: Record<string, string[]>;
  };
}

/** Standard success envelope. */
export interface ApiOk<T> {
  data: T;
}

export type ApiResult<T> = ApiOk<T> | ApiErrorBody;

/** Cursor/offset pagination envelope. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** The authenticated principal, as exposed to the web client. */
export interface SessionUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  role: Role;
}

export interface Tenant {
  id: string;
  name: string;
  /** Per-tenant accent color (hex). Defaults to the IRIS indigo. */
  accentColor: string;
  createdAt: string;
}
