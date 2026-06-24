import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes, Errors, genericErrorBody } from './errors.js';

describe('Errors factory', () => {
  it('maps each helper to the right code, status, and retryability', () => {
    expect([Errors.validation().code, Errors.validation().httpStatus]).toEqual([ErrorCodes.VALIDATION_FAILED, 400]);
    expect([Errors.unauthorized().code, Errors.unauthorized().httpStatus]).toEqual([ErrorCodes.AUTH_REQUIRED, 401]);
    expect([Errors.forbidden().code, Errors.forbidden().httpStatus]).toEqual([ErrorCodes.FORBIDDEN, 403]);
    expect([Errors.notFound().code, Errors.notFound().httpStatus]).toEqual([ErrorCodes.NOT_FOUND, 404]);
    expect([Errors.rateLimited().code, Errors.rateLimited().httpStatus]).toEqual([ErrorCodes.RATE_LIMITED, 429]);
    const up = Errors.upstream('Google down', 'retry');
    expect([up.code, up.httpStatus, up.retryable, up.recovery]).toEqual([
      ErrorCodes.UPSTREAM_UNAVAILABLE,
      503,
      true,
      'retry',
    ]);
  });

  it('toBody produces a client-safe envelope with the log reference', () => {
    const body = Errors.validation('Bad input').toBody('req-123');
    expect(body).toEqual({
      error: {
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Bad input',
        recovery: undefined,
        retryable: false,
        logRef: 'req-123',
        details: undefined,
      },
    });
  });

  it('AppError is an Error subclass and never leaks a cause into the body', () => {
    const err = Errors.internal(new Error('db exploded'));
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    const body = err.toBody('r1');
    expect(body.error.code).toBe(ErrorCodes.INTERNAL);
    expect(JSON.stringify(body)).not.toContain('db exploded');
  });

  it('genericErrorBody is a generic 500 envelope', () => {
    const body = genericErrorBody('r9');
    expect(body.error.code).toBe(ErrorCodes.INTERNAL);
    expect(body.error.logRef).toBe('r9');
    expect(body.error.retryable).toBe(true);
  });
});
