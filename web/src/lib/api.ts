import type { ApiErrorBody } from '@iris/shared';

/** Error thrown by the API client; carries the server's user-safe envelope. */
export class ApiError extends Error {
  readonly code: string;
  readonly recovery?: string;
  readonly retryable: boolean;
  readonly logRef: string;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.recovery = body.recovery;
    this.retryable = body.retryable;
    this.logRef = body.logRef;
    this.details = body.details;
  }
}

const API_BASE = '/api';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Typed fetch wrapper. Sends/receives JSON, includes session cookies, and
 * normalises every failure into an {@link ApiError} so callers (and React Query)
 * get a consistent, user-safe shape.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, {
      code: 'NETWORK',
      message: 'Could not reach the server.',
      recovery: 'Check your connection and try again.',
      retryable: true,
      logRef: 'client',
    });
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const errBody = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      errBody ?? {
        code: 'UNKNOWN',
        message: 'Unexpected error.',
        retryable: false,
        logRef: res.headers.get('x-request-id') ?? 'unknown',
      },
    );
  }

  return (json as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
