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
  /**
   * Stakeholder's email, ONLY when the source literally contains one (e.g. next to an
   * Owner/POC/Assigned-to column) — never inferred/guessed. Stored silently for
   * People-linking; not shown or editable in the Projects UI.
   */
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
    ownerEmail: {
      type: 'string',
      description:
        'The project stakeholder/owner\'s email address, ONLY if the source literally contains one (e.g. in or ' +
        'next to an Owner/POC/Stakeholder/Assigned-to column). Never invent or guess an email from a name. ' +
        'Empty string if none is present.',
    },
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
  required: ['name', 'summary', 'priority', 'status', 'ownerEmail', 'fields', 'tasks', 'stages', 'currentStage'],
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

/** Only accepts a value that actually looks like an email; anything else (hallucinated or malformed) is dropped. */
function normalizeOwnerEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 255);
  return trimmed && EMAIL_RE.test(trimmed) ? trimmed.toLowerCase() : null;
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
          `If a stakeholder/owner column (Owner/POC/Stakeholder/Assigned-to or similar) literally contains an email ` +
          `address, capture it in "ownerEmail" — never invent or guess one from a name. ` +
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

/**
 * A header cell is a short, single-line label. Data cells in real trackers often
 * hold long, multi-line prose (descriptions, remarks, multi-date timelines), so
 * counting label-like cells — not raw fill — separates the header from a data row
 * that happens to have more populated columns.
 */
function isLabelCell(cell: string): boolean {
  const t = cell.trim();
  return t.length > 0 && t.length <= 40 && !t.includes('\n');
}

/** Picks the most label-like row among the first few as the header. */
export function pickHeader(values: string[][]): { headerIdx: number; header: string[] } {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(values.length, 6);
  for (let i = 0; i < limit; i++) {
    const score = values[i]!.filter(isLabelCell).length;
    if (score > bestScore) {
      bestScore = score;
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
  /** Per-cell person/smart-chip email, parallel to `values` (null where none). */
  chipEmails?: (string | null)[][];
}

interface SheetChunk {
  tab: string;
  headerLine: string;
  records: string;
  /** normalized project-name → stakeholder chip email, for this chunk's tab. */
  emailByName: Map<string, string>;
}

// Header words that identify the stakeholder/owner column and the project-name column.
const STAKEHOLDER_COL_RE = /stake|owner|poc\b|dri\b|spoc|assign|responsibl|point of contact/i;
const NAME_COL_RE = /project|initiative|title|\bname\b|task|item|deliverable/i;

/** Case/space-insensitive key for matching an extracted project name back to its source row. */
export function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** First header column index matching `re`, or -1. */
function headerColIndex(header: string[], re: RegExp): number {
  return header.findIndex((h) => re.test(h ?? ''));
}

/** The stakeholder email for a row: prefer the stakeholder column's chip, else the first chip in the row. */
function rowStakeholderEmail(chips: (string | null)[], stakeCol: number): string | null {
  if (stakeCol >= 0 && chips[stakeCol]) return normalizeOwnerEmail(chips[stakeCol]);
  return normalizeOwnerEmail(chips.find((c) => !!c) ?? null);
}

/**
 * Maps each row's project name → its stakeholder person-chip email, so an
 * AI-extracted project (which uses the name column verbatim) can be linked back
 * to the real email deterministically — the email never enters the AI prompt, so
 * it can never leak into a project's visible fields. Names that map to conflicting
 * emails are dropped (ambiguous).
 */
export function buildOwnerEmailByName(
  header: string[],
  rows: string[][],
  chipRows: (string | null)[][],
): Map<string, string> {
  const nameCol = Math.max(0, headerColIndex(header, NAME_COL_RE));
  const stakeCol = headerColIndex(header, STAKEHOLDER_COL_RE);
  const map = new Map<string, string>();
  const conflicted = new Set<string>();
  rows.forEach((row, i) => {
    const email = rowStakeholderEmail(chipRows[i] ?? [], stakeCol);
    if (!email) return;
    const key = normalizeProjectName(row[nameCol] ?? '');
    if (!key || conflicted.has(key)) return;
    const existing = map.get(key);
    if (existing && existing !== email) {
      map.delete(key);
      conflicted.add(key);
      return;
    }
    map.set(key, email);
  });
  return map;
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
    // Zip each data row with its parallel chip-email row BEFORE filtering, so the
    // stakeholder email stays aligned to its row after empty rows are dropped.
    const chipGrid = tab.chipEmails ?? [];
    const dataPairs = tab.values
      .slice(headerIdx + 1)
      .map((row, i) => ({ row, chips: chipGrid[headerIdx + 1 + i] ?? [] }))
      .filter(({ row }) => row.some((c) => c.trim()));
    if (dataPairs.length === 0) continue;
    const dataRows = dataPairs.map((p) => p.row);
    // Real stakeholder chip email keyed by project name, for post-AI linking.
    const emailByName = buildOwnerEmailByName(
      header,
      dataRows,
      dataPairs.map((p) => p.chips),
    );
    const headerLine = header.map((h, i) => h.trim() || `Column ${i + 1}`).join(' | ');
    for (let i = 0; i < dataRows.length && usedRows < MAX_SHEET_DATA_ROWS; i += SHEET_ROW_CHUNK) {
      const slice = dataRows.slice(i, i + SHEET_ROW_CHUNK);
      usedRows += slice.length;
      const recs: string[] = [];
      slice.forEach((row, j) => {
        const rec = formatRecord(j + 1, header, row);
        if (rec) recs.push(rec);
      });
      if (recs.length) chunks.push({ tab: tab.title, headerLine, records: recs.join('\n'), emailByName });
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
            `If a stakeholder/owner column (Owner/POC/Stakeholder/Assigned-to/DRI or similar) literally contains an ` +
            `email address, put it in "ownerEmail" — never invent or guess an email from a name alone.`,
        ),
        messages: [{ role: 'user', content: chunk.records }],
        tool: EXTRACT_TOOL,
        maxTokens: 8000,
      });
      const raw = Array.isArray(result?.projects) ? result!.projects : [];
      return raw
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => normalizeProject(p, sourceName, ''))
        .map((p) => {
          // Link the real stakeholder chip email back to this project by name. The
          // chip email is authoritative over any literal email the AI happened to read.
          const chipEmail = chunk.emailByName.get(normalizeProjectName(p.name));
          return chipEmail ? { ...p, ownerEmail: chipEmail } : p;
        });
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
