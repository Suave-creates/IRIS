import type { ChatContextSource } from '@iris/shared';
import { gather } from './gather.js';
import { defaultRetriever, type Retriever } from './retriever.js';

/** Nominal context window used for the UI meter (matches the design). */
export const CONTEXT_WINDOW = 200_000;

const CONTEXT_CHAR_BUDGET = 6_000; // ≈ 1.5k tokens of injected context
const MAX_ITEMS = 10;
const MIN_SCORE = 0.08;

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export interface AssembledContext {
  /** Markdown block injected after the cached persona. Empty if nothing relevant. */
  contextBlock: string;
  /** Sources actually injected (for the context rail). */
  sources: ChatContextSource[];
  /** Estimated token size of the injected context. */
  contextTokens: number;
}

/**
 * The Context Construction Engine: Gather → Rank → Compress → Assemble.
 * Every chat turn is grounded through this — raw history is never sent alone.
 */
export async function assembleContext(args: {
  tenantId: string;
  userId: string;
  query: string;
  retriever?: Retriever;
}): Promise<AssembledContext> {
  const retriever = args.retriever ?? defaultRetriever;

  // Gather → Rank
  const candidates = await gather(args.tenantId, args.userId);
  const ranked = retriever.rank(args.query, candidates).filter((c) => c.score >= MIN_SCORE);

  // Compress → Assemble (greedy within a char budget)
  const chosen: typeof ranked = [];
  let chars = 0;
  for (const c of ranked) {
    if (chosen.length >= MAX_ITEMS) break;
    const piece = c.text.length + 24;
    if (chars + piece > CONTEXT_CHAR_BUDGET && chosen.length > 0) break;
    chosen.push(c);
    chars += piece;
  }

  const sources: ChatContextSource[] = chosen.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    sublabel: c.sublabel,
    relevance: Math.min(99, Math.round(c.score * 100)),
  }));

  if (chosen.length === 0) {
    return { contextBlock: '', sources: [], contextTokens: 0 };
  }

  const lines = chosen.map((c, i) => `${i + 1}. [${c.kind}] ${c.text}`);
  const contextBlock =
    `## Relevant context (assembled and ranked by the IRIS Context Engine)\n` +
    `Use this grounding when it helps; cite naturally (e.g. "from the Acme thread"). ` +
    `If it doesn't apply, ignore it. Do not invent facts beyond it.\n\n` +
    lines.join('\n');

  return { contextBlock, sources, contextTokens: estimateTokens(contextBlock) };
}
