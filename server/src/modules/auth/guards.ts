import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role, SessionUser } from '@iris/shared';
import { Errors } from '../../lib/errors.js';
import { userRepo } from '../users/user.repo.js';
import { readSessionCookie, sessionService } from './session.service.js';
import { toSessionUser } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated principal, or null for anonymous requests. */
    authUser: SessionUser | null;
    /** The current session id, or null. */
    sessionId: string | null;
  }
}

/**
 * Resolves the session cookie → user on every request (when a cookie is present)
 * and exposes `request.authUser`. Does not reject anonymous requests; route-level
 * guards enforce access.
 */
export async function registerAuthContext(app: FastifyInstance): Promise<void> {
  app.decorateRequest('authUser', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const sid = readSessionCookie(req);
    if (!sid) return;
    const session = await sessionService.getValid(sid);
    if (!session) return;
    const user = await userRepo.findById(session.user_id);
    if (!user || user.status === 'disabled') return;
    req.authUser = toSessionUser(user);
    req.sessionId = session.id;
  });
}

/** preHandler: requires an authenticated user. */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.authUser) throw Errors.unauthorized();
}

/** preHandler factory: requires the user to hold one of the given roles. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.authUser) throw Errors.unauthorized();
    if (!roles.includes(req.authUser.role)) {
      throw Errors.forbidden('You need a higher role to do that.');
    }
  };
}

/** Helper for handlers that have passed requireAuth — returns the non-null user. */
export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.authUser) throw Errors.unauthorized();
  return req.authUser;
}
