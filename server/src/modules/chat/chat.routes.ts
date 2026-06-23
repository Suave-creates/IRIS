import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { currentUser, requireAuth } from '../auth/guards.js';
import { userRepo } from '../users/user.repo.js';
import { chatRepo } from './chat.repo.js';
import { runTurn } from './chat.service.js';

const sendSchema = z.object({
  conversationId: z.string().min(1).optional(),
  text: z.string().min(1).max(8000),
});
const idParam = z.object({ id: z.string().min(1) });

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/conversations', async (req) => {
    const me = currentUser(req);
    return { data: await chatRepo.listConversations(me.tenantId, me.id) };
  });

  app.get('/conversations/:id/messages', async (req) => {
    const me = currentUser(req);
    const { id } = idParam.parse(req.params);
    const conv = await chatRepo.getConversation(me.tenantId, me.id, id);
    if (!conv) return { data: [] };
    return { data: await chatRepo.listMessages(me.tenantId, id) };
  });

  // SSE: stream a grounded chat turn. Events: `delta` (token), `done` (result), `error`.
  app.post('/message', async (req, reply) => {
    const me = currentUser(req);
    const body = sendSchema.parse(req.body); // validate before hijacking the socket
    const settings = await userRepo.getSettings(me.id);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) =>
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());

    try {
      const result = await runTurn({
        tenantId: me.tenantId,
        userId: me.id,
        userName: me.name,
        settings,
        conversationId: body.conversationId ?? null,
        text: body.text,
        onText: (delta) => send('delta', { text: delta }),
        signal: ac.signal,
      });
      send('done', result);
    } catch (err) {
      req.log.error({ err }, 'chat turn failed');
      const message =
        err instanceof AppError ? err.message : 'IRIS could not complete that. Please try again.';
      send('error', { message });
    } finally {
      raw.end();
    }
  });
}
