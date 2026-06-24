import type Anthropic from '@anthropic-ai/sdk';
import type { ChatTurnResult, WhiteboardInsight } from '@iris/shared';
import type { UserSettings } from '../auth/types.js';
import { execute } from '../../db/pool.js';
import { hasAnthropic } from '../../config/env.js';
import { id } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { streamChat, extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { RENDER_INSIGHT_TOOL, normalizeInsight } from '../../lib/insight.js';
import { assembleContext, CONTEXT_WINDOW } from '../context/engine.js';
import { chatRepo } from './chat.repo.js';
import { persona, PREPARE_ACTIONS_TOOL, REFLECT_SYSTEM, type ReflectResult } from './prompts.js';

const INSIGHT_SYSTEM =
  'You turn an assistant answer into OPTIONAL supporting infographics. Call render_insight. ' +
  'Only produce blocks when the answer contains quantitative data, comparisons, trends, key metrics, or structured ' +
  'records that genuinely benefit from a chart (bar for category comparisons, line for trends), KPI cards, or a table. ' +
  'If the answer is purely conversational or has no real numbers, return an EMPTY blocks array. ' +
  'Never invent data — use only numbers present in the answer or the context. Keep it tight: a few cards, one chart, or one table.';

/** Best-effort: turns a chat answer into a visual artifact, or null when none applies. */
async function generateChatInsight(query: string, reply: string, contextBlock: string): Promise<WhiteboardInsight | null> {
  // Infographics need numbers — skip the extra AI call on purely conversational replies.
  if (!hasAnthropic || !/\d/.test(reply)) return null;
  try {
    const result = await extractWithTool<{ title?: unknown; blocks?: unknown[] }>({
      system: systemBlocks(INSIGHT_SYSTEM),
      messages: [
        {
          role: 'user',
          content:
            `User asked:\n"""${query}"""\n\nIRIS answered:\n"""${reply}"""\n\n` +
            `Context available (use only real numbers from here or the answer):\n${contextBlock || '(none)'}\n\n` +
            `Produce supporting infographics via render_insight, or empty blocks if none apply.`,
        },
      ],
      tool: RENDER_INSIGHT_TOOL,
      maxTokens: 2000,
    });
    const insight = normalizeInsight(result, 'Details');
    return insight.blocks.length ? insight : null;
  } catch (err) {
    logger.warn({ err }, 'chat insight generation failed (non-fatal)');
    return null;
  }
}

export interface RunTurnArgs {
  tenantId: string;
  userId: string;
  userName: string;
  settings: UserSettings;
  conversationId: string | null;
  text: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

/** Runs one grounded chat turn: assemble context → stream reply → persist → reflect. */
export async function runTurn(args: RunTurnArgs): Promise<ChatTurnResult> {
  const { tenantId, userId, text } = args;

  // 1. Resolve or create the conversation.
  let conversationId = args.conversationId;
  if (conversationId) {
    const conv = await chatRepo.getConversation(tenantId, userId, conversationId);
    if (!conv) conversationId = null;
  }
  if (!conversationId) {
    conversationId = await chatRepo.createConversation(tenantId, userId, text.slice(0, 60) || 'New conversation');
  }

  // 2. Persist the user's message.
  await chatRepo.addMessage(tenantId, conversationId, 'user', text);

  // 3. Context Engine: gather → rank → compress → assemble.
  const { contextBlock, sources } = await assembleContext({ tenantId, userId, query: text });

  // 4. Build the prompt: cached persona + volatile context, then trimmed history.
  const system = systemBlocks(persona(args.userName), contextBlock || undefined);
  const history = await chatRepo.recentForContext(tenantId, conversationId, 12);
  const messages: Anthropic.MessageParam[] = [];
  for (const m of history) {
    const role: Anthropic.MessageParam['role'] = m.role === 'iris' ? 'assistant' : 'user';
    // Anthropic requires the first message to be from the user.
    if (messages.length === 0 && role !== 'user') continue;
    messages.push({ role, content: m.content });
  }
  if (messages.length === 0) messages.push({ role: 'user', content: text });

  // 5. Stream the grounded reply.
  const { text: reply, usage } = await streamChat({
    system,
    messages,
    maxTokens: 2048,
    onText: args.onText,
    signal: args.signal,
  });

  // 6. Persist the assistant reply.
  const irisMsgId = await chatRepo.addMessage(tenantId, conversationId, 'iris', reply);

  // 7. In parallel: reflect (actions + memories) and build an optional visual artifact.
  const [actionsPrepared, artifact] = await Promise.all([
    reflect({ ...args, conversationId, reply, irisMsgId }).catch((err) => {
      logger.warn({ err }, 'reflect step failed (non-fatal)');
      return 0;
    }),
    generateChatInsight(text, reply, contextBlock),
  ]);

  const artifactJson = artifact ? JSON.stringify(artifact) : null;
  if (artifactJson) await chatRepo.setMessageArtifact(irisMsgId, artifactJson);

  return {
    conversationId,
    sources,
    tokens: { used: usage.inputTokens + usage.outputTokens, window: CONTEXT_WINDOW },
    actionsPrepared,
    artifact: artifactJson,
  };
}

async function reflect(
  args: RunTurnArgs & { conversationId: string; reply: string; irisMsgId: string },
): Promise<number> {
  const result = await extractWithTool<ReflectResult>({
    system: systemBlocks(REFLECT_SYSTEM),
    messages: [
      {
        role: 'user',
        content: `The executive said:\n"""${args.text}"""\n\nIRIS replied:\n"""${args.reply}"""\n\nExtract actions to prepare and memories to store.`,
      },
    ],
    tool: PREPARE_ACTIONS_TOOL,
    maxTokens: 1200,
  });
  if (!result) return 0;

  let prepared = 0;

  // External actions → pending approvals.
  for (const a of result.actions ?? []) {
    if (!a.title) continue;
    await execute(
      `INSERT INTO actions (id, tenant_id, user_id, conversation_id, kind, target, title, detail, payload, status)
       VALUES (:id, :t, :u, :c, :k, :tg, :ti, :d, :p, 'pending')`,
      {
        id: id('act'),
        t: args.tenantId,
        u: args.userId,
        c: args.conversationId,
        k: a.kind,
        tg: a.target || 'IRIS',
        ti: a.title,
        d: a.detail ?? null,
        p: a.payload ? JSON.stringify(a.payload) : null,
      },
    );
    prepared++;
  }

  // Memories → auto-saved or queued for approval, per settings.
  if (args.settings.continuousLearning) {
    for (const mem of result.memories ?? []) {
      if (!mem.content) continue;
      if (args.settings.autoSaveMemory) {
        await execute(
          `INSERT INTO memories (id, tenant_id, type, content, source, scope) VALUES (:id, :t, :ty, :c, :s, 'long')`,
          { id: id('mem'), t: args.tenantId, ty: mem.type, c: mem.content, s: mem.source ?? 'chat · today' },
        );
      } else {
        await execute(
          `INSERT INTO actions (id, tenant_id, user_id, conversation_id, kind, target, title, detail, payload, status)
           VALUES (:id, :t, :u, :c, 'Save memory', 'Long-term', :ti, :d, :p, 'pending')`,
          {
            id: id('act'),
            t: args.tenantId,
            u: args.userId,
            c: args.conversationId,
            ti: mem.content.slice(0, 120),
            d: `Store to long-term memory (${mem.type}).`,
            p: JSON.stringify({ type: mem.type, content: mem.content, source: mem.source ?? 'chat · today' }),
          },
        );
        prepared++;
      }
    }
  }

  if (prepared > 0) await chatRepo.markMessageActions(args.irisMsgId);
  return prepared;
}
