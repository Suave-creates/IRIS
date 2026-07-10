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
  /** Stakeholder/owner name, when the source states one (e.g. an Owner/POC/Assigned-to column). */
  owner: string | null;
  /** Stakeholder's email, ONLY when the source literally contains one — never inferred/guessed. */
  ownerEmail: string | null;
  fields: { label: string; value: string }[];
  tasks: { title: string }[];
  stages: string[];
  currentStage: number;
}

const PROJECT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Concise project name' },
    summary: { type: 'string', description: '1–2 crisp, action-oriented sentences for an executive' },
    priority: { type: 'string', enum: ['critical', 'high', 'med', 'low'] },
    deadline: { type: 'string', description: 'YYYY-MM-DD if a clear deadline exists, else empty string' },
    status: { type: 'string', description: 'e.g. Planning, In progress, Review, At risk, Blocked, On track' },
    owner: {
      type: 'string',
      description:
        'The stakeholder/owner\'s real name, if the source names one (an Owner/POC/Stakeholder/Assigned-to column ' +
        'or similar). Empty string if no specific person is named.',
    },
    ownerEmail: {
      type: 'string',
      description:
        'The stakeholder\'s email address, ONLY if the source literally contains one next to their name. ' +
        'Never invent or guess an email from a name. Empty string if none is present.',
    },
    fields: {
      type: 'array',
      description: '3–5 key facts as label/value pairs (exclude owner/stakeholder — that has its own field above)',
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
  required: ['name', 'summary', 'priority', 'status', 'owner', 'ownerEmail', 'fields', 'tasks', 'stages', 'currentStage'],
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_projects',
  description: 'Record every distinct executive project distilled from the source content.',
  input_schema: {
    type: 'object',
    properties: {
      projects: {
        type: 'array',
        description:
          'All distinct, real projects found in the source. If the source is a tracker/sheet that lists many ' +
          'projects (typically one per row), return ONE entry per project — never merge them. Filter out noise, ' +
          'headers, totals, and empty/irrelevant rows.',
        items: PROJECT_ITEM_SCHEMA,
      },
    },
    required: ['projects'],
  },
};

/** Upper bound on cards extracted from a single source (guards against runaway sheets). */
const MAX_PROJECTS_PER_SOURCE = 150;
/** Rows per AI call when extracting from a tracker sheet (keeps each call well clear of truncation). */
const SHEET_ROW_CHUNK = 14;
/** Hard ceiling on data rows considered from one sheet, summed across all tabs. */
const MAX_SHEET_DATA_ROWS = 400;
/** Concurrent chunk extractions (balances latency against upstream rate limits). */
const CHUNK_CONCURRENCY = 4;

function normalizeDeadline(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const VALID_PRIORITY = new Set<Priority>(['critical', 'high', 'med', 'low']);

/** Loose email shape check — good enough to reject obvious non-emails without over-validating. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims a possibly-empty raw string; empty/non-string becomes null. */
function normalizeOptionalText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** Only accepts a value that actually looks like an email; anything else (hallucinated or malformed) is dropped. */
function normalizeOwnerEmail(raw: unknown): string | null {
  const text = normalizeOptionalText(raw, 255);
  return text && EMAIL_RE.test(text) ? text.toLowerCase() : null;
}

/** Coerces one raw tool-emitted project object into a safe ExtractedProject. */
export function normalizeProject(raw: Record<string, unknown>, sourceName: string, content: string): ExtractedProject {
  const priority = VALID_PRIORITY.has(raw.priority as Priority) ? (raw.priority as Priority) : 'med';
  const fields = Array.isArray(raw.fields)
    ? (raw.fields as { label?: unknown; value?: unknown }[])
        .filter((f) => typeof f.label === 'string' && typeof f.value === 'string')
        .map((f) => ({ label: String(f.label).slice(0, 80), value: String(f.value).slice(0, 200) }))
    : [];
  const tasks = Array.isArray(raw.tasks)
    ? (raw.tasks as { title?: unknown }[])
        .filter((t) => typeof t.title === 'string')
        .map((t) => ({ title: String(t.title).slice(0, 255) }))
    : [];
  const stages = Array.isArray(raw.stages)
    ? (raw.stages as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const summary = content.replace(/\s+/g, ' ').trim().slice(0, 180) || `Project from ${sourceName}.`;
  return {
    name: (typeof raw.name === 'string' && raw.name.trim()) || sourceName,
    summary: (typeof raw.summary === 'string' && raw.summary.trim()) || summary,
    priority,
    status: (typeof raw.status === 'string' && raw.status.trim()) || 'In progress',
    deadline: normalizeDeadline(raw.deadline),
    owner: normalizeOptionalText(raw.owner, 160),
    ownerEmail: normalizeOwnerEmail(raw.ownerEmail),
    fields: fields.length ? fields : [{ label: 'Source', value: sourceName }],
    tasks,
    stages: stages.length ? stages : ['Planning', 'In progress', 'Review', 'Done'],
    currentStage: typeof raw.currentStage === 'number' ? Math.max(0, Math.min(raw.currentStage, (stages.length || 4) - 1)) : 1,
  };
}

/**
 * Distills EVERY distinct, relevant project from (noisy) source content using Claude.
 * A tracker sheet that lists many projects yields one card per project.
 */
export async function extractProjects(
  type: 'folder' | 'sheet' | 'doc',
  sourceName: string,
  content: string,
): Promise<ExtractedProject[]> {
  const fallback: ExtractedProject = {
    name: sourceName,
    summary: content.replace(/\s+/g, ' ').trim().slice(0, 180) || `Project from ${sourceName}.`,
    priority: 'med',
    status: 'In progress',
    deadline: null,
    owner: null,
    ownerEmail: null,
    fields: [{ label: 'Source', value: sourceName }],
    tasks: [],
    stages: ['Planning', 'In progress', 'Review', 'Done'],
    currentStage: 1,
  };
  if (!hasAnthropic || !content.trim()) return [fallback];

  try {
    const result = await extractWithTool<{ projects?: unknown[] }>({
      system: systemBlocks(
        `You are IRIS, an executive chief-of-staff. The text below is the (often noisy) content of a linked ${type} named "${sourceName}". ` +
          `Identify EVERY distinct, real project it describes and call record_projects exactly once with all of them. ` +
          `Many sources are trackers that list one project per row — return one entry per project and never merge them. ` +
          `Ignore boilerplate, navigation, signatures, repeated headers, totals, and empty or irrelevant rows. ` +
          `For each project write a tight, action-oriented summary, a sensible priority and status, 3–5 key fields, ` +
          `realistic ordered stages with the current index, and up to 5 concrete next tasks. ` +
          `If the source names a real stakeholder/owner (an Owner/POC/Stakeholder/Assigned-to column or similar), ` +
          `capture their name in "owner", and their email in "ownerEmail" ONLY if the source literally states one — ` +
          `never invent or guess an email from a name. ` +
          `If the source contains no real project, return an empty projects array.`,
      ),
      messages: [{ role: 'user', content: `Source: ${sourceName} (${type})\n\nContent:\n"""${content}"""` }],
      tool: EXTRACT_TOOL,
      // Headroom for many rich cards — a truncated tool response would parse-fail and
      // collapse back to a single fallback card.
      maxTokens: 16000,
    });

    const rawProjects = Array.isArray(result?.projects) ? result!.projects : [];
    const projects = rawProjects
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .slice(0, MAX_PROJECTS_PER_SOURCE)
      .map((p) => normalizeProject(p, sourceName, content));
    return projects.length ? projects : [fallback];
  } catch (err) {
    logger.warn({ err, sourceName }, 'project extraction failed — using fallback');
    return [fallback];
  }
}

// ── Structured sheet extraction (one card per row, chunked + parallel) ──────────

/** Picks the most label-dense row among the first few as the header. */
export function pickHeader(values: string[][]): { headerIdx: number; header: string[] } {
  let bestIdx = 0;
  let bestCount = -1;
  const limit = Math.min(values.length, 6);
  for (let i = 0; i < limit; i++) {
    const count = values[i]!.filter((c) => c.trim()).length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = i;
    }
  }
  return { headerIdx: bestIdx, header: values[bestIdx] ?? [] };
}

/** Renders one sheet row as a labeled, unambiguous record; null if the row is empty. */
export function formatRecord(n: number, header: string[], row: string[]): string | null {
  const cols = Math.max(header.length, row.length);
  const pairs: string[] = [];
  for (let c = 0; c < cols; c++) {
    const val = (row[c] ?? '').trim();
    if (!val) continue;
    const label = (header[c] ?? '').trim() || `Column ${c + 1}`;
    pairs.push(`${label}: ${val}`);
  }
  return pairs.length ? `[${n}] ${pairs.join(' | ')}` : null;
}

/** Runs an async mapper over items with bounded concurrency. */
async function runPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

export interface SheetTabInput {
  title: string;
  values: string[][];
}

interface SheetChunk {
  tab: string;
  headerLine: string;
  records: string;
}

/**
 * Extracts one project card PER ROW from a tracker sheet, across EVERY tab.
 * Each tab gets its own header detection; rows are split into labeled records and
 * processed in parallel chunks, so a multi-tab, 70-row workbook yields ~70 cards.
 */
export async function extractProjectsFromSheet(sourceName: string, tabs: SheetTabInput[]): Promise<ExtractedProject[]> {
  const fallback: ExtractedProject = {
    name: sourceName,
    summary: `Project from ${sourceName}.`,
    priority: 'med',
    status: 'In progress',
    deadline: null,
    owner: null,
    ownerEmail: null,
    fields: [{ label: 'Source', value: sourceName }],
    tasks: [],
    stages: ['Planning', 'In progress', 'Review', 'Done'],
    currentStage: 1,
  };

  const nonEmptyTabs = tabs.filter((t) => t.values.some((r) => r.some((c) => c.trim())));
  if (!hasAnthropic || nonEmptyTabs.length === 0) return [fallback];

  // Build labeled-record chunks across all tabs, each tagged with its tab + header.
  const chunks: SheetChunk[] = [];
  let usedRows = 0;
  for (const tab of nonEmptyTabs) {
    if (usedRows >= MAX_SHEET_DATA_ROWS) break;
    const { headerIdx, header } = pickHeader(tab.values);
    const dataRows = tab.values.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim()));
    if (dataRows.length === 0) continue;
    const headerLine = header.map((h, i) => h.trim() || `Column ${i + 1}`).join(' | ');
    for (let i = 0; i < dataRows.length && usedRows < MAX_SHEET_DATA_ROWS; i += SHEET_ROW_CHUNK) {
      const slice = dataRows.slice(i, i + SHEET_ROW_CHUNK);
      usedRows += slice.length;
      const recs: string[] = [];
      slice.forEach((row, j) => {
        const rec = formatRecord(j + 1, header, row);
        if (rec) recs.push(rec);
      });
      if (recs.length) chunks.push({ tab: tab.title, headerLine, records: recs.join('\n') });
    }
  }

  // No tabular data rows anywhere — fall back to whole-workbook text extraction.
  if (chunks.length === 0) {
    const text = nonEmptyTabs
      .map((t) => `## Tab: ${t.title}\n${t.values.map((r) => r.join(' | ')).join('\n')}`)
      .join('\n\n');
    return extractProjects('sheet', sourceName, text);
  }

  const perChunk = await runPooled(chunks, CHUNK_CONCURRENCY, async (chunk) => {
    try {
      const result = await extractWithTool<{ projects?: unknown[] }>({
        system: systemBlocks(
          `You are IRIS, an executive chief-of-staff, building project cards from a tracker sheet named "${sourceName}" ` +
            `(tab "${chunk.tab}"). The columns of this tab are: ${chunk.headerLine}. ` +
            `Below are numbered records — EACH record is one row of the tab and represents ONE project. ` +
            `Call record_projects exactly once and emit ONE project per record that is a real project. ` +
            `SKIP a record only if it is empty, a repeated header, or a section/subtotal/total row — otherwise always include it. ` +
            `Use the project-name column for the name; write a tight 1–2 sentence executive summary from the row; ` +
            `infer a sensible priority and status from the status/importance columns; put the 3–5 most useful columns as fields; ` +
            `set a deadline from any ETA/timeline column (YYYY-MM-DD, else empty); and add concrete next tasks the row implies. ` +
            `If any column names a stakeholder/owner (Owner/POC/Stakeholder/Assigned-to/DRI or similar), put their ` +
            `name in "owner"; if that same column (or an adjacent one) literally contains an email address, put it ` +
            `in "ownerEmail" — never invent or guess an email from a name alone.`,
        ),
        messages: [{ role: 'user', content: chunk.records }],
        tool: EXTRACT_TOOL,
        maxTokens: 8000,
      });
      const raw = Array.isArray(result?.projects) ? result!.projects : [];
      return raw
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => normalizeProject(p, sourceName, ''));
    } catch (err) {
      logger.warn({ err, sourceName, tab: chunk.tab }, 'sheet chunk extraction failed — skipping chunk');
      return [] as ExtractedProject[];
    }
  });

  const projects = perChunk.flat().slice(0, MAX_PROJECTS_PER_SOURCE);
  return projects.length ? projects : [fallback];
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
