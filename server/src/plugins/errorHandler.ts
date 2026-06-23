import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, ErrorCodes, Errors, genericErrorBody } from '../lib/errors.js';

/**
 * Centralised error + 404 handling. Guarantees every failure response is a
 * user-safe ApiErrorBody carrying a logRef (the request id) — raw exceptions
 * and stack traces are never sent to clients.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const logRef = request.id;
    reply.header('x-request-id', logRef);

    if (error instanceof AppError) {
      if (error.httpStatus >= 500) {
        request.log.error({ err: error, code: error.code }, 'app error (server)');
      } else {
        request.log.info({ code: error.code, msg: error.message }, 'app error (client)');
      }
      return reply.status(error.httpStatus).send(error.toBody(logRef));
    }

    if (error instanceof ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || '_';
        (details[key] ??= []).push(issue.message);
      }
      const appErr = Errors.validation('Some fields need attention.', details);
      return reply.status(appErr.httpStatus).send(appErr.toBody(logRef));
    }

    // Fastify schema validation
    if ((error as { validation?: unknown }).validation) {
      const message = error instanceof Error ? error.message : 'The request was invalid.';
      const appErr = Errors.validation(message);
      return reply.status(appErr.httpStatus).send(appErr.toBody(logRef));
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      const appErr = Errors.rateLimited();
      return reply.status(appErr.httpStatus).send(appErr.toBody(logRef));
    }

    // Framework-level client errors (e.g. malformed JSON body, 413) carry a 4xx
    // statusCode — return a clean envelope, not a 500.
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 401
          ? ErrorCodes.AUTH_REQUIRED
          : statusCode === 403
            ? ErrorCodes.FORBIDDEN
            : statusCode === 404
              ? ErrorCodes.NOT_FOUND
              : ErrorCodes.VALIDATION_FAILED;
      const message = statusCode === 413 ? 'The request was too large.' : 'The request was invalid.';
      request.log.info({ code, statusCode }, 'client error');
      return reply.status(statusCode).send({ error: { code, message, retryable: false, logRef } });
    }

    // Unknown / unexpected — log the full error, expose nothing.
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(genericErrorBody(logRef));
  });

  app.setNotFoundHandler((request, reply) => {
    const appErr = Errors.notFound(`No route for ${request.method} ${request.url}.`);
    reply.header('x-request-id', request.id);
    return reply.status(appErr.httpStatus).send(appErr.toBody(request.id));
  });
}
