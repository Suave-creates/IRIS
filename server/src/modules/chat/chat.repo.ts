import type { RowDataPacket } from 'mysql2/promise';
import type { ChatMessage, Conversation } from '@iris/shared';
import { execute, query } from '../../db/pool.js';
import { id } from '../../lib/ids.js';

interface ConvRow extends RowDataPacket {
  id: string;
  title: string;
  updated_at: string;
}
interface MsgRow extends RowDataPacket {
  id: string;
  role: 'user' | 'iris';
  content: string;
  has_actions: number;
  created_at: string;
}

export const chatRepo = {
  async createConversation(tenantId: string, userId: string, title: string): Promise<string> {
    const convId = id('conv');
    await execute(
      'INSERT INTO conversations (id, tenant_id, user_id, title) VALUES (:id, :t, :u, :title)',
      { id: convId, t: tenantId, u: userId, title: title.slice(0, 180) },
    );
    return convId;
  },

  async getConversation(tenantId: string, userId: string, convId: string): Promise<ConvRow | null> {
    const rows = await query<ConvRow[]>(
      'SELECT * FROM conversations WHERE id = :id AND tenant_id = :t AND user_id = :u',
      { id: convId, t: tenantId, u: userId },
    );
    return rows[0] ?? null;
  },

  async listConversations(tenantId: string, userId: string): Promise<Conversation[]> {
    const rows = await query<ConvRow[]>(
      'SELECT id, title, updated_at FROM conversations WHERE tenant_id = :t AND user_id = :u ORDER BY updated_at DESC LIMIT 50',
      { t: tenantId, u: userId },
    );
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  },

  async listMessages(tenantId: string, convId: string): Promise<ChatMessage[]> {
    const rows = await query<MsgRow[]>(
      'SELECT id, role, content, has_actions, created_at FROM conversation_messages WHERE conversation_id = :c AND tenant_id = :t ORDER BY created_at',
      { c: convId, t: tenantId },
    );
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      text: r.content,
      createdAt: r.created_at,
      hasActions: !!r.has_actions,
    }));
  },

  /** Recent messages for context assembly (oldest→newest), capped. */
  async recentForContext(tenantId: string, convId: string, limit = 12): Promise<MsgRow[]> {
    const rows = await query<MsgRow[]>(
      'SELECT id, role, content, has_actions, created_at FROM conversation_messages WHERE conversation_id = :c AND tenant_id = :t ORDER BY created_at DESC LIMIT :lim',
      { c: convId, t: tenantId, lim: limit },
    );
    return rows.reverse();
  },

  async addMessage(
    tenantId: string,
    convId: string,
    role: 'user' | 'iris',
    content: string,
    hasActions = false,
  ): Promise<string> {
    const msgId = id('msg');
    await execute(
      'INSERT INTO conversation_messages (id, conversation_id, tenant_id, role, content, has_actions) VALUES (:id, :c, :t, :r, :content, :ha)',
      { id: msgId, c: convId, t: tenantId, r: role, content, ha: hasActions ? 1 : 0 },
    );
    await execute('UPDATE conversations SET updated_at = NOW() WHERE id = :c', { c: convId });
    return msgId;
  },

  async markMessageActions(msgId: string): Promise<void> {
    await execute('UPDATE conversation_messages SET has_actions = 1 WHERE id = :id', { id: msgId });
  },
};
