import type { ApiErrorBody } from '@iris/shared';

/** Stable, machine-readable error codes surfaced to clients. */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  httpStatus: number;
  recovery?: string;
  retryable?: boolean;
  details?: Record<string, string[]>;
  cause?: unknown;
}

/**
 * Application error carrying everything needed to build a user-safe envelope.
 * Raw exceptions are never exposed — they are mapped to AppError or a generic 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly recovery?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, string[]>;

  constructor(opts: AppErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.recovery = opts.recovery;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }

  toBody(logRef: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        recovery: this.recovery,
        retryable: this.retryable,
        logRef,
        details: this.details,
      },
    };
  }
}

export const Errors = {
  validation: (message = 'The request was invalid.', details?: Record<string, string[]>) =>
    new AppError({ code: ErrorCodes.VALIDATION_FAILED, message, httpStatus: 400, details }),
  unauthorized: (message = 'You need to sign in to continue.') =>
    new AppError({ code: ErrorCodes.AUTH_REQUIRED, message, httpStatus: 401, recovery: 'Sign in and try again.' }),
  forbidden: (message = 'You do not have access to this resource.') =>
    new AppError({ code: ErrorCodes.FORBIDDEN, message, httpStatus: 403 }),
  notFound: (message = 'The requested resource was not found.') =>
    new AppError({ code: ErrorCodes.NOT_FOUND, message, httpStatus: 404 }),
  conflict: (message = 'This conflicts with the current state.') =>
    new AppError({ code: ErrorCodes.CONFLICT, message, httpStatus: 409 }),
  rateLimited: (message = 'Too many requests. Please slow down.') =>
    new AppError({ code: ErrorCodes.RATE_LIMITED, message, httpStatus: 429, retryable: true, recovery: 'Wait a moment and retry.' }),
  upstream: (message = 'An upstream service is temporarily unavailable.', recovery = 'Please retry shortly.') =>
    new AppError({ code: ErrorCodes.UPSTREAM_UNAVAILABLE, message, httpStatus: 503, retryable: true, recovery }),
  internal: (cause?: unknown, message = 'Something went wrong on our end.') =>
    new AppError({ code: ErrorCodes.INTERNAL, message, httpStatus: 500, retryable: true, cause, recovery: 'Try again, and contact support with the log reference if it persists.' }),
};

/** Generic 500 body for unmapped exceptions (never leaks internals). */
export function genericErrorBody(logRef: string): ApiErrorBody {
  return {
    error: {
      code: ErrorCodes.INTERNAL,
      message: 'Something went wrong on our end.',
      recovery: 'Try again, and contact support with the log reference if it persists.',
      retryable: true,
      logRef,
    },
  };
}
