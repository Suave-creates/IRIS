import type Anthropic from '@anthropic-ai/sdk';
import type { Priority } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { complete, extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { logger } from '../../lib/logger.js';

export interface ExtractedProject {
  name: string;
  summary: string;
  priority: Priority;
  deadline: string | null;
  status: string;
  fields: { label: string; value: string }[];
  tasks: { title: string }[];
  stages: string[];
  currentStage: number;
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_project',
  description: 'Record the single most relevant executive project distilled from the source content.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Concise project name' },
      summary: { type: 'string', description: '1–2 crisp, action-oriented sentences for an executive' },
      priority: { type: 'string', enum: ['critical', 'high', 'med', 'low'] },
      deadline: { type: 'string', description: 'YYYY-MM-DD if a clear deadline exists, else empty string' },
      status: { type: 'string', description: 'e.g. Planning, In progress, Review, At risk, Blocked, On track' },
      fields: {
        type: 'array',
        description: '3–5 key facts as label/value pairs',
        items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] },
      },
      tasks: {
        type: 'array',
        description: 'Up to 5 concrete next tasks',
        items: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      },
      stages: { type: 'array', items: { type: 'string' }, description: 'Ordered milestone names' },
      currentStage: { type: 'integer', description: 'Index into stages of the current milestone' },
    },
    required: ['name', 'summary', 'priority', 'status', 'fields', 'tasks', 'stages', 'currentStage'],
  },
};

function normalizeDeadline(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const VALID_PRIORITY = new Set<Priority>(['critical', 'high', 'med', 'low']);

/** Distills one clean, relevant project from (noisy) source content using Claude. */
export async function extractProject(
  type: 'folder' | 'sheet' | 'doc',
  sourceName: string,
  content: string,
): Promise<ExtractedProject> {
  const fallback: ExtractedProject = {
    name: sourceName,
    summary: content.replace(/\s+/g, ' ').trim().slice(0, 180) || `Project from ${sourceName}.`,
    priority: 'med',
    status: 'In progress',
    deadline: null,
    fields: [{ label: 'Source', value: sourceName }],
    tasks: [],
    stages: ['Planning', 'In progress', 'Review', 'Done'],
    currentStage: 1,
  };
  if (!hasAnthropic || !content.trim()) return fallback;

  try {
    const result = await extractWithTool<Record<string, unknown>>({
      system: systemBlocks(
        `You are IRIS, an executive chief-of-staff. The text below is the (often noisy) content of a linked ${type} named "${sourceName}". ` +
          `Extract the SINGLE most relevant executive project. Ignore boilerplate, navigation, signatures, repeated headers, and irrelevant chatter. ` +
          `Write a tight, action-oriented summary. Choose a sensible priority and status, 3–5 key fields, realistic ordered stages with the current index, and up to 5 concrete next tasks. ` +
          `If there is no real project, produce a best-effort card named after the source. Call record_project exactly once.`,
      ),
      messages: [{ role: 'user', content: `Source: ${sourceName} (${type})\n\nContent:\n"""${content}"""` }],
      tool: EXTRACT_TOOL,
      maxTokens: 1200,
    });
    if (!result) return fallback;

    const priority = VALID_PRIORITY.has(result.priority as Priority) ? (result.priority as Priority) : 'med';
    const fields = Array.isArray(result.fields)
      ? (result.fields as { label?: unknown; value?: unknown }[])
          .filter((f) => typeof f.label === 'string' && typeof f.value === 'string')
          .map((f) => ({ label: String(f.label).slice(0, 80), value: String(f.value).slice(0, 200) }))
      : [];
    const tasks = Array.isArray(result.tasks)
      ? (result.tasks as { title?: unknown }[])
          .filter((t) => typeof t.title === 'string')
          .map((t) => ({ title: String(t.title).slice(0, 255) }))
      : [];
    const stages = Array.isArray(result.stages)
      ? (result.stages as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    return {
      name: (typeof result.name === 'string' && result.name.trim()) || sourceName,
      summary: (typeof result.summary === 'string' && result.summary.trim()) || fallback.summary,
      priority,
      status: (typeof result.status === 'string' && result.status.trim()) || 'In progress',
      deadline: normalizeDeadline(result.deadline),
      fields: fields.length ? fields : fallback.fields,
      tasks,
      stages: stages.length ? stages : fallback.stages,
      currentStage: typeof result.currentStage === 'number' ? Math.max(0, Math.min(result.currentStage, (stages.length || 4) - 1)) : 1,
    };
  } catch (err) {
    logger.warn({ err, sourceName }, 'project extraction failed — using fallback');
    return fallback;
  }
}

/** Writes a short AI summary for a manually-created project. */
export async function summarizeManual(name: string, description?: string | null): Promise<string> {
  if (!hasAnthropic) return (description ?? '').slice(0, 280);
  try {
    const text = await complete({
      system: systemBlocks(
        'You are IRIS. Write a single crisp, executive-grade sentence (max 200 chars) summarizing a project. No preamble, no quotes.',
      ),
      messages: [{ role: 'user', content: `Project: ${name}${description ? `\nContext: ${description}` : ''}` }],
      maxTokens: 120,
    });
    return text.trim().slice(0, 280) || (description ?? '').slice(0, 280);
  } catch {
    return (description ?? '').slice(0, 280);
  }
}
