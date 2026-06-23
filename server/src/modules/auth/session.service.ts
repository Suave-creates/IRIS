import type { FastifyReply, FastifyRequest } from 'fastify';
import { env, isProd } from '../../config/env.js';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import type { SessionRow } from './types.js';

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export const sessionService = {
  async create(input: CreateSessionInput): Promise<SessionRow> {
    const sessionId = id('ses');
    await execute(
      `INSERT INTO sessions (id, user_id, tenant_id, ip, user_agent, expires_at)
       VALUES (:id, :uid, :tid, :ip, :ua, DATE_ADD(NOW(), INTERVAL :days DAY))`,
      {
        id: sessionId,
        uid: input.userId,
        tid: input.tenantId,
        ip: input.ip ?? null,
        ua: input.userAgent ?? null,
        days: env.SESSION_TTL_DAYS,
      },
    );
    const rows = await query<SessionRow[]>('SELECT * FROM sessions WHERE id = :id', { id: sessionId });
    return rows[0]!;
  },

  /** Returns the session row iff it exists, is not revoked, and is unexpired. */
  async getValid(sessionId: string): Promise<SessionRow | null> {
    const rows = await query<SessionRow[]>(
      'SELECT * FROM sessions WHERE id = :id AND revoked_at IS NULL AND expires_at > NOW()',
      { id: sessionId },
    );
    return rows[0] ?? null;
  },

  async revoke(sessionId: string): Promise<void> {
    await execute('UPDATE sessions SET revoked_at = NOW() WHERE id = :id AND revoked_at IS NULL', { id: sessionId });
  },

  async revokeAllForUser(userId: string, exceptId?: string): Promise<number> {
    const result = await execute(
      `UPDATE sessions SET revoked_at = NOW()
       WHERE user_id = :uid AND revoked_at IS NULL AND (:except IS NULL OR id <> :except)`,
      { uid: userId, except: exceptId ?? null },
    );
    return result.affectedRows;
  },

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    return query<SessionRow[]>(
      `SELECT * FROM sessions WHERE user_id = :uid AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      { uid: userId },
    );
  },
};

// ── Cookie helpers ───────────────────────────────────────────────────────────

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,
  path: '/',
  signed: true,
};

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(env.COOKIE_NAME, sessionId, {
    ...cookieBase,
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.COOKIE_NAME, { ...cookieBase });
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[env.COOKIE_NAME];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
