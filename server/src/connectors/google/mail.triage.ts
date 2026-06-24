import type Anthropic from '@anthropic-ai/sdk';
import type { TaskPriority } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { logger } from '../../lib/logger.js';

export interface TriageInput {
  from: string;
  subject: string;
  body: string;
}
export interface Triage {
  summary: string;
  category: string;
  priority: TaskPriority;
  tags: string[];
}

/** Categories must match the web Mail view's CATEGORY_META keys. */
const CATEGORIES = ['approvals', 'deadlines', 'finance', 'meetings', 'intros', 'decisions', 'tasks', 'fyi'] as const;
const CATEGORY_SET = new Set<string>(CATEGORIES);
const PRIORITY_SET = new Set<TaskPriority>(['high', 'med', 'low']);
const MAX_BODY = 2_500;

const TRIAGE_TOOL: Anthropic.Tool = {
  name: 'record_triage',
  description: 'Record triage for each email, in the same order they were given.',
  input_schema: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        description: 'One entry per input email.',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'The [n] number of the email this entry triages.' },
            summary: { type: 'string', description: 'One or two crisp sentences: what it is and what it needs from the exec.' },
            category: { type: 'string', enum: [...CATEGORIES] },
            priority: { type: 'string', enum: ['high', 'med', 'low'] },
            tags: { type: 'array', items: { type: 'string' }, description: '1–3 short topic tags' },
          },
          required: ['index', 'summary', 'category', 'priority'],
        },
      },
    },
    required: ['emails'],
  },
};

export function normalizeTriage(raw: unknown): Triage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!summary) return null;
  const category = typeof r.category === 'string' && CATEGORY_SET.has(r.category) ? r.category : 'fyi';
  const priority = (typeof r.priority === 'string' && PRIORITY_SET.has(r.priority as TaskPriority) ? r.priority : 'med') as TaskPriority;
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 3)
    : [];
  return { summary: summary.slice(0, 1000), category, priority, tags };
}

/**
 * Maps raw tool-emitted triage entries back to the input order by their `index`, so a
 * dropped or reordered entry can never misattribute a summary to the wrong email.
 * Returns a parallel array of length `count` (null where nothing usable was returned).
 */
export function mapTriageResults(raw: unknown[], count: number): (Triage | null)[] {
  const byIndex = new Map<number, Triage>();
  for (const entry of raw) {
    const idx = entry && typeof entry === 'object' ? Number((entry as Record<string, unknown>).index) : NaN;
    const triage = normalizeTriage(entry);
    if (Number.isInteger(idx) && triage && !byIndex.has(idx)) byIndex.set(idx, triage);
  }
  return Array.from({ length: count }, (_, i) => byIndex.get(i + 1) ?? null);
}

/**
 * Triages a batch of emails with Claude — summary, category, priority, tags per email.
 * Returns a parallel array (null where the model gave nothing usable); callers fall
 * back to the keyword heuristic. Returns all-null when no Anthropic key is set.
 */
export async function triageEmails(emails: TriageInput[]): Promise<(Triage | null)[]> {
  if (!hasAnthropic || emails.length === 0) return emails.map(() => null);

  const numbered = emails
    .map((e, i) => `[${i + 1}]\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body.slice(0, MAX_BODY) || '(no body)'}`)
    .join('\n\n---\n\n');

  try {
    const result = await extractWithTool<{ emails?: unknown[] }>({
      system: systemBlocks(
        'You are IRIS, an executive chief-of-staff triaging an inbox. For EACH numbered email, in order, return a crisp ' +
          '1–2 sentence summary (what it is + what it needs), a category, a priority, and 1–3 short tags. ' +
          'Categories: approvals, deadlines, finance, meetings, intros, decisions, tasks, fyi. ' +
          'Priority: high = needs the executive personally and soon; med = relevant but not urgent; low = FYI or noise. ' +
          'Strip quoted replies, signatures, and disclaimers from your reasoning. Call record_triage exactly once with one ' +
          'entry per email, each tagged with its [n] index.',
      ),
      messages: [{ role: 'user', content: `Triage these ${emails.length} emails:\n\n${numbered}` }],
      tool: TRIAGE_TOOL,
      maxTokens: 4000,
    });

    // Map by the model-provided index so a dropped/reordered entry can't misattribute a summary.
    const arr = Array.isArray(result?.emails) ? result!.emails : [];
    return mapTriageResults(arr, emails.length);
  } catch (err) {
    logger.warn({ err, count: emails.length }, 'mail triage failed — falling back to heuristic');
    return emails.map(() => null);
  }
}
