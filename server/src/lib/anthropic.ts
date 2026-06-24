import Anthropic from '@anthropic-ai/sdk';
import { env, hasAnthropic } from '../config/env.js';
import { Errors } from './errors.js';
import { logger } from './logger.js';

let client: Anthropic | null = null;

/** Lazily-constructed Anthropic client. Throws a clear error if no key is set. */
export function getAnthropic(): Anthropic {
  if (!hasAnthropic) {
    throw Errors.upstream('The AI service is not configured.', 'Set ANTHROPIC_API_KEY and restart the server.');
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    logger.info({ model: env.ANTHROPIC_MODEL }, 'Anthropic client created');
  }
  return client;
}

export const MODEL = env.ANTHROPIC_MODEL;

/** A stable text block marked for prompt caching (cache_control honored by the API). */
function cachedBlock(text: string): Anthropic.TextBlockParam {
  const block: Anthropic.TextBlockParam = { type: 'text', text };
  // cache_control is GA on current models but untyped in this SDK version.
  (block as unknown as Record<string, unknown>).cache_control = { type: 'ephemeral' };
  return block;
}

/** Standing style rule appended to every persona so all AI output stays clean. */
const STYLE_RULE =
  ' Never use emojis or decorative symbols in your output; keep the tone professional, precise, and restrained.';

/** A system prompt rendered as cacheable blocks: a stable persona + a volatile context block. */
export function systemBlocks(persona: string, context?: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [cachedBlock(persona + STYLE_RULE)];
  if (context) blocks.push({ type: 'text', text: context });
  return blocks;
}

export interface StreamChatOptions {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  /** Called with each text delta as it streams. */
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface StreamChatResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

/** Streams a chat completion, invoking onText per delta, and returns the full text + usage. */
export async function streamChat(opts: StreamChatOptions): Promise<StreamChatResult> {
  const stream = getAnthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: opts.messages,
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  stream.on('text', (delta) => opts.onText(delta));
  const final = await stream.finalMessage();

  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const cacheRead = (final.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  return {
    text,
    usage: {
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      cacheReadTokens: cacheRead,
    },
  };
}

/** Non-streaming completion that forces a single tool call and returns its parsed input. */
export async function extractWithTool<T>(opts: {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tool: Anthropic.Tool;
  maxTokens?: number;
}): Promise<T | null> {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: opts.messages,
    tools: [opts.tool],
    tool_choice: { type: 'tool', name: opts.tool.name },
  });
  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.tool.name,
  );
  return block ? (block.input as T) : null;
}

/** Plain non-streaming text completion (used by Lens/Mail synthesis). */
export async function complete(opts: {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}): Promise<string> {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
