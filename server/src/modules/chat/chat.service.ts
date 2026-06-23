import type Anthropic from '@anthropic-ai/sdk';
import type { ChatTurnResult } from '@iris/shared';
import type { UserSettings } from '../auth/types.js';
import { execute } from '../../db/pool.js';
import { id } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { streamChat, extractWithTool, systemBlocks } from '../../lib/anthropic.js';
import { assembleContext, CONTEXT_WINDOW } from '../context/engine.js';
import { chatRepo } from './chat.repo.js';
import { persona, PREPARE_ACTIONS_TOOL, REFLECT_SYSTEM, type ReflectResult } from './prompts.js';

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

  // 7. Reflect: extract actions + memories from the exchange.
  let actionsPrepared = 0;
  try {
    actionsPrepared = await reflect({ ...args, conversationId, reply, irisMsgId });
  } catch (err) {
    logger.warn({ err }, 'reflect step failed (non-fatal)');
  }

  return {
    conversationId,
    sources,
    tokens: { used: usage.inputTokens + usage.outputTokens, window: CONTEXT_WINDOW },
    actionsPrepared,
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
