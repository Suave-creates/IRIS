import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/guards.js';
import { Errors } from '../../lib/errors.js';
import { projectsRepo } from './projects.repo.js';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(['critical', 'high', 'med', 'low']),
  deadline: z.string().trim().min(1).max(40).nullish(),
});

const createSourceSchema = z.object({
  type: z.enum(['folder', 'sheet', 'doc']),
});

const toggleTaskSchema = z.object({
  done: z.boolean(),
});

const projectParamsSchema = z.object({
  id: z.string().min(1),
});

const taskParamsSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
});

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── Sources (declared before '/:id' so the literal path wins) ─────────────
  app.get('/sources', async (req) => {
    const me = currentUser(req);
    return { data: await projectsRepo.listSources(me.tenantId) };
  });

  app.post('/sources', async (req) => {
    const me = currentUser(req);
    const { type } = createSourceSchema.parse(req.body);
    return { data: await projectsRepo.createSource(me.tenantId, type) };
  });

  // ── Auto-scan: mark sources scanned + idempotently seed auto projects ─────
  app.post('/fetch', async (req) => {
    const me = currentUser(req);
    await projectsRepo.markSourcesScanned(me.tenantId);
    await projectsRepo.seedAutoProjects(me.tenantId);
    return { data: await projectsRepo.listByTenant(me.tenantId) };
  });

  // ── Projects ──────────────────────────────────────────────────────────────
  app.get('/', async (req) => {
    const me = currentUser(req);
    return { data: await projectsRepo.listByTenant(me.tenantId) };
  });

  app.post('/', async (req) => {
    const me = currentUser(req);
    const body = createProjectSchema.parse(req.body);
    const project = await projectsRepo.createManual(me.tenantId, {
      name: body.name,
      priority: body.priority,
      deadline: body.deadline ?? null,
      owner: 'You',
    });
    return { data: project };
  });

  app.get('/:id', async (req) => {
    const me = currentUser(req);
    const { id: projectId } = projectParamsSchema.parse(req.params);
    const project = await projectsRepo.getById(me.tenantId, projectId);
    if (!project) throw Errors.notFound('Project not found.');
    return { data: project };
  });

  // Toggle a task's done flag; parent-project tenant ownership is verified in the repo.
  app.patch('/:id/tasks/:taskId', async (req) => {
    const me = currentUser(req);
    const { id: projectId, taskId } = taskParamsSchema.parse(req.params);
    const { done } = toggleTaskSchema.parse(req.body);

    const ownerProjectId = await projectsRepo.findTaskProjectId(me.tenantId, taskId);
    if (!ownerProjectId || ownerProjectId !== projectId) {
      throw Errors.notFound('Task not found.');
    }

    await projectsRepo.setTaskDone(me.tenantId, taskId, done);

    const project = await projectsRepo.getById(me.tenantId, projectId);
    if (!project) throw Errors.notFound('Project not found.');
    return { data: project };
  });
}
