import type Anthropic from '@anthropic-ai/sdk';
import type { InsightBlock, WhiteboardAiAction, WhiteboardInsight } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { logger } from '../../lib/logger.js';

export interface AiFile {
  title: string;
  kind: string;
  content: string;
}

const MAX_TOTAL = 60_000;
const MAX_PER_FILE = 50_000;

const ACTION_INSTRUCTION: Record<WhiteboardAiAction, string> = {
  summarize:
    'Summarize the files. Lead with the headline metrics as KPI cards, then a short markdown takeaway. Add a chart if there is a trend or comparison worth showing.',
  reconcile:
    'Find inconsistencies, conflicts, and contradictions ACROSS the files — mismatched numbers, dates, owners, claims. Present them in a table (Item | File A | File B | Issue) plus a short markdown verdict. If everything is consistent, say so.',
  board:
    'Produce a board-ready briefing: KPI cards for the key metrics, a chart of the most important trend or comparison, then a tight markdown section on status, risks, and decisions needed.',
  custom: '',
};

/** Title for the generated insight window (fallback default). */
export function insightTitle(action: WhiteboardAiAction): string {
  switch (action) {
    case 'summarize':
      return 'Summary of files';
    case 'reconcile':
      return 'Cross-file reconciliation';
    case 'board':
      return 'Board summary';
    default:
      return 'AI insight';
  }
}

const RENDER_TOOL: Anthropic.Tool = {
  name: 'render_insight',
  description: 'Render an executive insight as an ordered mix of prose, KPI cards, tables, and charts.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short, specific title for the insight window' },
      blocks: {
        type: 'array',
        description:
          'Ordered content blocks. Be visual: use a chart for trends (line) or comparisons across categories like ' +
          'departments (bar); KPI cards for headline numbers; a table for structured records; markdown for commentary. ' +
          'Only use numbers that appear in the files — never invent data.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['markdown', 'kpis', 'table', 'chart'] },
            text: { type: 'string', description: 'Markdown body (when type=markdown)' },
            items: {
              type: 'array',
              description: 'KPI cards (when type=kpis)',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  sub: { type: 'string', description: 'Optional sub-label, e.g. a delta or unit' },
                },
                required: ['label', 'value'],
              },
            },
            columns: { type: 'array', items: { type: 'string' }, description: 'Table header (when type=table)' },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Table rows (when type=table)',
            },
            chart: { type: 'string', enum: ['line', 'bar'], description: 'Chart type (when type=chart)' },
            xLabel: { type: 'string' },
            yLabel: { type: 'string' },
            series: {
              type: 'array',
              description: 'Chart series (when type=chart)',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { x: { type: 'string' }, y: { type: 'number' } },
                      required: ['x', 'y'],
                    },
                  },
                },
                required: ['name', 'points'],
              },
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['title', 'blocks'],
  },
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Validates/normalizes one raw tool-emitted block; returns null if unusable. */
function normalizeBlock(raw: unknown): InsightBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'markdown': {
      const text = asString(b.text).trim();
      return text ? { type: 'markdown', text } : null;
    }
    case 'kpis': {
      const items = Array.isArray(b.items)
        ? b.items
            .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
            .map((i) => ({ label: asString(i.label).slice(0, 60), value: asString(i.value).slice(0, 40), sub: i.sub != null ? asString(i.sub).slice(0, 60) : null }))
            .filter((i) => i.label && i.value)
        : [];
      return items.length ? { type: 'kpis', items } : null;
    }
    case 'table': {
      const columns = Array.isArray(b.columns) ? b.columns.map(asString) : [];
      const rows = Array.isArray(b.rows)
        ? b.rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map(asString))
        : [];
      return columns.length && rows.length ? { type: 'table', columns, rows } : null;
    }
    case 'chart': {
      const chart = b.chart === 'line' || b.chart === 'bar' ? b.chart : 'bar';
      const series = Array.isArray(b.series)
        ? b.series
            .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
            .map((s) => ({
              name: asString(s.name) || 'Series',
              points: Array.isArray(s.points)
                ? s.points
                    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
                    .map((p) => ({ x: asString(p.x), y: Number(p.y) }))
                    .filter((p) => p.x !== '' && Number.isFinite(p.y))
                : [],
            }))
            .filter((s) => s.points.length > 0)
        : [];
      return series.length
        ? { type: 'chart', chart, title: b.title != null ? asString(b.title) : null, xLabel: b.xLabel != null ? asString(b.xLabel) : null, yLabel: b.yLabel != null ? asString(b.yLabel) : null, series }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Runs cross-file reasoning over the AI-included files and returns a visual insight
 * (KPI cards / tables / charts / prose). Falls back to a markdown note when no
 * Anthropic key is configured or no usable blocks are produced.
 */
export async function runWhiteboardAi(
  action: WhiteboardAiAction,
  prompt: string | null,
  files: AiFile[],
): Promise<WhiteboardInsight> {
  const fallbackTitle = action === 'custom' ? 'AI insight' : insightTitle(action);

  if (!hasAnthropic) {
    const names = files.map((f) => `- **${f.title}** (${f.kind})`).join('\n');
    return { title: fallbackTitle, blocks: [{ type: 'markdown', text: `AI is not configured.\n\nFiles in context:\n${names}` }] };
  }

  const instruction = action === 'custom' ? (prompt?.trim() ?? '') : ACTION_INSTRUCTION[action];

  // Assemble a bounded, clearly-delimited context block.
  let used = 0;
  const blocks: string[] = [];
  for (const f of files) {
    const slice = f.content.slice(0, MAX_PER_FILE);
    if (used + slice.length > MAX_TOTAL) break;
    used += slice.length;
    blocks.push(`### FILE: ${f.title} (${f.kind})\n${slice || '(no readable content)'}`);
  }
  const context = blocks.join('\n\n');

  try {
    const result = await extractWithTool<{ title?: unknown; blocks?: unknown[] }>({
      system: systemBlocks(
        'You are IRIS, an executive chief-of-staff turning files into a visual briefing on a whiteboard. ' +
          'Reason ACROSS the files and ALWAYS call render_insight exactly once. Be visual and quantitative: ' +
          'reach for a bar chart to compare categories (e.g. department-wise yield), a line chart for trends over time, ' +
          'KPI cards for the few headline numbers, and a table for structured records — use markdown only for the connective ' +
          'commentary. Pull every number straight from the files; never fabricate data. ' +
          'Sheets often have many day/date columns — when asked for the "latest" period, use the rightmost columns that ' +
          'actually contain values. Ignore error cells (#DIV/0!, #VALUE!, #REF!) and implausible outliers. Be concise.',
      ),
      messages: [
        {
          role: 'user',
          content: `${instruction || 'Analyze these files and surface what matters, visually.'}\n\nFiles on the whiteboard:\n\n${context}`,
        },
      ],
      tool: RENDER_TOOL,
      maxTokens: 4000,
    });

    const rawBlocks = Array.isArray(result?.blocks) ? result!.blocks : [];
    const normalized = rawBlocks.map(normalizeBlock).filter((b): b is InsightBlock => b !== null);
    const title = (typeof result?.title === 'string' && result.title.trim()) || fallbackTitle;

    if (normalized.length === 0) {
      return { title, blocks: [{ type: 'markdown', text: 'No insight could be generated from the files in context.' }] };
    }
    return { title: title.slice(0, 120), blocks: normalized };
  } catch (err) {
    logger.warn({ err, action }, 'whiteboard AI failed');
    return { title: fallbackTitle, blocks: [{ type: 'markdown', text: 'The AI request failed. Please try again.' }] };
  }
}
