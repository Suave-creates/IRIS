import type { WhiteboardAiAction, WhiteboardInsight } from '@iris/shared';
import { hasAnthropic } from '../../config/env.js';
import { extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { RENDER_INSIGHT_TOOL, normalizeInsight } from '../../lib/insight.js';
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
      tool: RENDER_INSIGHT_TOOL,
      maxTokens: 4000,
    });

    const insight = normalizeInsight(result, fallbackTitle);
    if (insight.blocks.length === 0) {
      return { title: insight.title, blocks: [{ type: 'markdown', text: 'No insight could be generated from the files in context.' }] };
    }
    return insight;
  } catch (err) {
    logger.warn({ err, action }, 'whiteboard AI failed');
    return { title: fallbackTitle, blocks: [{ type: 'markdown', text: 'The AI request failed. Please try again.' }] };
  }
}
