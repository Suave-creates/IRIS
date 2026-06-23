import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatContextSource, ChatMessage } from '@iris/shared';
import { streamMessage } from './api';

let tmpSeq = 0;
const tmpId = () => `tmp_${Date.now()}_${tmpSeq++}`;

export interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  sources: ChatContextSource[];
  tokens: { used: number; window: number };
  error: string | null;
}

/** Drives the Ask IRIS conversation: optimistic messages + SSE streaming + reflect result. */
export function useChat() {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sources, setSources] = useState<ChatContextSource[]>([]);
  const [tokens, setTokens] = useState({ used: 0, window: 200_000 });
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);
      setSending(true);

      const userMsg: ChatMessage = { id: tmpId(), role: 'user', text: trimmed, createdAt: new Date().toISOString() };
      const irisId = tmpId();
      const irisMsg: ChatMessage = { id: irisId, role: 'iris', text: '', createdAt: new Date().toISOString() };
      setMessages((m) => [...m, userMsg, irisMsg]);

      const appendDelta = (delta: string) =>
        setMessages((m) => m.map((msg) => (msg.id === irisId ? { ...msg, text: msg.text + delta } : msg)));

      await streamMessage(
        { conversationId: conversationId.current ?? undefined, text: trimmed },
        {
          onDelta: appendDelta,
          onDone: (result) => {
            conversationId.current = result.conversationId;
            setSources(result.sources);
            setTokens(result.tokens);
            if (result.actionsPrepared > 0) {
              setMessages((m) => m.map((msg) => (msg.id === irisId ? { ...msg, hasActions: true } : msg)));
              qc.invalidateQueries({ queryKey: ['actions'] });
              qc.invalidateQueries({ queryKey: ['dashboard'] });
            }
          },
          onError: (message) => {
            setError(message);
            // Drop the empty assistant bubble on hard failure.
            setMessages((m) => m.filter((msg) => !(msg.id === irisId && msg.text === '')));
          },
        },
      );
      setSending(false);
    },
    [sending, qc],
  );

  return { messages, sending, sources, tokens, error, send } satisfies ChatState & { send: typeof send };
}
