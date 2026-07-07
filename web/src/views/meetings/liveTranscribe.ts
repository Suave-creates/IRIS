/**
 * Near-real-time transcription driver. Records a stream in self-contained
 * ~intervalMs WebM segments — a FRESH MediaRecorder per segment, so each blob
 * decodes on its own (unlike timeslice chunks, which lack the WebM header) —
 * sends each to `transcribe`, and reports the text via `onText`. The next
 * segment starts the instant the previous stops, so the audio gap is
 * negligible. Entirely best-effort: any failure just skips one live update and
 * never disturbs the caller's separate full-audio recording.
 */
export interface LiveTranscriptionOptions {
  stream: MediaStream;
  mimeType: string;
  intervalMs: number;
  transcribe: (form: FormData) => Promise<{ text: string }>;
  onText: (text: string) => void;
}

export interface LiveTranscriptionHandle {
  stop: () => void;
}

export function startLiveTranscription(opts: LiveTranscriptionOptions): LiveTranscriptionHandle {
  const { stream, mimeType, intervalMs, transcribe, onText } = opts;
  let stopped = false;
  let timer: number | null = null;
  let active: MediaRecorder | null = null;

  const runSegment = (): void => {
    if (stopped) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType });
    } catch {
      return; // MediaRecorder unsupported for this stream — live feed just won't update
    }
    active = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      // Start the next segment immediately to keep the audio gap near zero.
      if (!stopped) runSegment();
      if (chunks.length === 0) return;
      const form = new FormData();
      form.append('audio', new Blob(chunks, { type: mimeType }), 'chunk.webm');
      transcribe(form)
        .then((res) => {
          if (!stopped && res.text.trim()) onText(res.text.trim());
        })
        .catch(() => undefined);
    };
    try {
      rec.start();
    } catch {
      return;
    }
    timer = window.setTimeout(() => {
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
    }, intervalMs);
  };

  runSegment();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active && active.state !== 'inactive') {
        try {
          active.stop();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
