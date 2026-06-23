import type { Connector, ConnectorProvider } from '@iris/shared';
import { api } from '@/lib/api';

export const connectorsApi = {
  /** Every connector belonging to the caller's tenant. */
  list: () => api.get<Connector[]>('/connectors'),
  disconnect: (provider: ConnectorProvider) => api.post<{ ok: boolean }>(`/connectors/${provider}/disconnect`),
  sync: (provider: ConnectorProvider) =>
    api.post<{ provider: string; ok: boolean; imported: number; detail: string; error?: string }>(
      `/connectors/${provider}/sync`,
    ),
};

/** Full-page redirect into the Google connector authorization flow. */
export function startConnect(provider: ConnectorProvider): void {
  window.location.href = `/api/connectors/${provider}/connect`;
}

export interface SyncAllProgress {
  provider: ConnectorProvider;
  phase: 'start' | 'done';
  outcome?: { ok: boolean; imported: number; detail: string };
}

/** Streams "Sync Everything" progress over SSE. */
export async function streamSyncAll(cb: {
  onProgress: (e: SyncAllProgress) => void;
  onDone: (r: { imported: number }) => void;
  onError: (m: string) => void;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/connectors/sync-all', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
    });
  } catch {
    cb.onError('Could not reach the server.');
    return;
  }
  if (!res.ok || !res.body) {
    cb.onError('Sync is unavailable right now.');
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const frame = (f: string) => {
    let ev = 'message';
    const data: string[] = [];
    for (const line of f.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join('\n'));
    } catch {
      return;
    }
    if (ev === 'progress') cb.onProgress(payload as SyncAllProgress);
    else if (ev === 'done') cb.onDone(payload as { imported: number });
    else if (ev === 'error') cb.onError((payload as { message: string }).message);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      frame(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
}
