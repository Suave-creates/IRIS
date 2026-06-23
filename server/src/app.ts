import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { env, isProd } from './config/env.js';
import { Errors } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { requestId } from './lib/ids.js';
import { healthRoutes } from './modules/health/health.routes.js';
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

  // Routes — health is exposed both bare (infra) and under /api (client).
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: '/health' });
    },
    { prefix: '/api' },
  );

  return app;
}
