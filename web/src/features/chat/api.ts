import type { ChatMessage, ChatTurnResult, Conversation } from '@iris/shared';
import { api } from '@/lib/api';

export interface ChatStreamCallbacks {
  onDelta: (text: string) => void;
  onDone: (result: ChatTurnResult) => void;
  onError: (message: string) => void;
}

/**
 * Streams a chat turn over SSE (POST → ReadableStream). The browser EventSource
 * API only supports GET, so we parse the `event:`/`data:` frames ourselves.
 */
export async function streamMessage(
  body: { conversationId?: string; text: string },
  cb: ChatStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat/message', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    cb.onError('Could not reach IRIS. Check your connection and try again.');
    return;
  }

  if (!res.ok || !res.body) {
    cb.onError('IRIS is unavailable right now. Please try again.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleFrame = (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    if (event === 'delta') cb.onDelta((payload as { text: string }).text);
    else if (event === 'done') cb.onDone(payload as ChatTurnResult);
    else if (event === 'error') cb.onError((payload as { message: string }).message);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      handleFrame(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
}

export const chatApi = {
  conversations: () => api.get<Conversation[]>('/chat/conversations'),
  messages: (id: string) => api.get<ChatMessage[]>(`/chat/conversations/${id}/messages`),
};
