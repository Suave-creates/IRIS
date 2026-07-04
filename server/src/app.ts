import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { env, isProd } from './config/env.js';
import { Errors } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { requestId } from './lib/ids.js';
import { actionsRoutes } from './modules/actions/actions.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { registerAuthContext } from './modules/auth/guards.js';
import { calendarRoutes } from './modules/calendar/calendar.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { connectorsRoutes } from './modules/connectors/connectors.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { journalRoutes } from './modules/journal/journal.routes.js';
import { lensRoutes } from './modules/lens/lens.routes.js';
import { mailRoutes } from './modules/mail/mail.routes.js';
import { meetingsRoutes } from './modules/meetings/meetings.routes.js';
import { memoryRoutes } from './modules/memory/memory.routes.js';
import { peopleRoutes } from './modules/people/people.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { projectsRoutes } from './modules/projects/projects.routes.js';
import { whiteboardRoutes } from './modules/whiteboard/whiteboard.routes.js';
import { meRoutes } from './modules/users/me.routes.js';
import { registerErrorHandling } from './plugins/errorHandler.js';

/** Builds the fully-configured Fastify application (without listening). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => requestId(),
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB
    disableRequestLogging: false,
  });

  await app.register(helmet, {
    // The SPA is served separately; relax CSP here and harden at the edge/CDN.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    parseOptions: { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' },
  });

  // Recorder audio uploads (POST /api/meetings/audio): mic + call channels.
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 2 } });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (request) => {
      const err = Errors.rateLimited();
      return err.toBody(request.id);
    },
  });

  registerErrorHandling(app);

  // Resolve the session cookie → request.authUser on every request.
  await registerAuthContext(app);

  // Routes — health is exposed both bare (infra) and under /api (client).
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: '/health' });
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(meRoutes, { prefix: '/me' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(projectsRoutes, { prefix: '/projects' });
      await api.register(whiteboardRoutes, { prefix: '/whiteboard' });
      await api.register(journalRoutes, { prefix: '/journal' });
      await api.register(peopleRoutes, { prefix: '/people' });
      await api.register(meetingsRoutes, { prefix: '/meetings' });
      await api.register(calendarRoutes, { prefix: '/calendar' });
      await api.register(mailRoutes, { prefix: '/mail' });
      await api.register(memoryRoutes, { prefix: '/memory' });
      await api.register(connectorsRoutes, { prefix: '/connectors' });
      await api.register(notificationsRoutes, { prefix: '/notifications' });
      await api.register(actionsRoutes, { prefix: '/actions' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(chatRoutes, { prefix: '/chat' });
      await api.register(lensRoutes, { prefix: '/lens' });
    },
    { prefix: '/api' },
  );

  return app;
}
