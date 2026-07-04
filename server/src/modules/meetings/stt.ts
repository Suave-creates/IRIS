import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecordingTranscriptLine } from '@iris/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Server-side speech-to-text over the local faster-whisper venv. Accuracy over
 * speed: the CPU int8 large-v3 run can take minutes, so the timeout is
 * generous and every failure degrades to `null` (callers fall back to the
 * browser's live preview transcript).
 */

// ── Contract with server/whisper/transcribe.py (single JSON object on stdout) ─

export interface SttSegment {
  start: number;
  end: number;
  text: string;
}

export interface SttResult {
  engine: string;
  segments: SttSegment[];
}

/** 30 minutes — a long recording on CPU int8 genuinely takes this long. */
const TRANSCRIBE_TIMEOUT_MS = 30 * 60_000;

/** server/whisper/transcribe.py, resolved from src/ and dist/ layouts alike. */
function transcribeScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // server/{src,dist}/modules/meetings → server/whisper/transcribe.py
    resolve(here, '..', '..', '..', 'whisper', 'transcribe.py'),
    resolve(process.cwd(), 'whisper', 'transcribe.py'),
    resolve(process.cwd(), 'server', 'whisper', 'transcribe.py'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * Parses transcribe.py's stdout — exactly one JSON object of the shape
 * {"engine","language","durationSecs","segments":[{"start","end","text"}]} —
 * into a sanitized SttResult, or null when the output does not conform.
 * Exported for tests (pure).
 */
export function parseSttOutput(stdout: string): SttResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.segments)) return null;
  const segments: SttSegment[] = [];
  for (const raw of obj.segments) {
    if (!raw || typeof raw !== 'object') continue;
    const seg = raw as Record<string, unknown>;
    const start = typeof seg.start === 'number' && Number.isFinite(seg.start) ? Math.max(0, seg.start) : null;
    const end = typeof seg.end === 'number' && Number.isFinite(seg.end) ? Math.max(0, seg.end) : null;
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (start === null || end === null || !text) continue;
    segments.push({ start, end, text: text.slice(0, 2000) });
  }
  const engine =
    typeof obj.engine === 'string' && obj.engine.trim() ? obj.engine.trim().slice(0, 40) : `whisper-${env.WHISPER_MODEL}`;
  return { engine, segments };
}

/**
 * Transcribes one audio file with the local Whisper venv. Returns null on any
 * failure (missing venv, non-zero exit, malformed output, timeout) after a
 * logger.warn — never throws.
 */
export async function transcribeFile(filePath: string, language: string | null): Promise<SttResult | null> {
  const script = transcribeScriptPath();
  const args = [script, filePath, '--model', env.WHISPER_MODEL];
  if (language && language.trim() && language.trim().toLowerCase() !== 'auto') {
    args.push('--language', language.trim());
  }

  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: SttResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(env.WHISPER_PYTHON, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      logger.warn({ err, filePath }, 'whisper transcription failed to spawn');
      resolvePromise(null);
      return;
    }

    const timer = setTimeout(() => {
      logger.warn({ filePath, timeoutMs: TRANSCRIBE_TIMEOUT_MS }, 'whisper transcription timed out — killing');
      child.kill();
      finish(null);
    }, TRANSCRIBE_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      logger.warn({ err, filePath }, 'whisper transcription process error');
      finish(null);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ code, filePath, stderr: stderr.slice(-400) }, 'whisper transcription exited non-zero');
        finish(null);
        return;
      }
      const result = parseSttOutput(stdout);
      if (!result) {
        logger.warn({ filePath, stdout: stdout.slice(0, 200) }, 'whisper transcription produced unparseable output');
      }
      finish(result);
    });
  });
}

// ── Channel → transcript-line mapping (pure, exported for tests) ─────────────

/** The consistent placeholder for unattributed remote-channel speech. */
export const UNKNOWN_SPEAKER = 'Unknown Speaker';

/**
 * Builds ordered transcript lines from the two capture channels: mic segments
 * speak as the signed-in executive's real name, call segments as the
 * "Unknown Speaker" placeholder (Claude attributes them to real people later).
 */
export function mergeChannelSegments(
  userName: string,
  mic: SttSegment[],
  call: SttSegment[],
): RecordingTranscriptLine[] {
  const name = userName.trim().slice(0, 80) || 'You';
  const stamped = [
    ...mic.map((s) => ({ start: s.start, speaker: name, text: s.text })),
    ...call.map((s) => ({ start: s.start, speaker: UNKNOWN_SPEAKER, text: s.text })),
  ];
  stamped.sort((a, b) => a.start - b.start);
  return stamped.map((s) => ({ tsSecs: Math.max(0, Math.round(s.start)), speaker: s.speaker, text: s.text }));
}

/**
 * Maps a browser live-preview channel label onto the recorder convention:
 * the executive's channel ("You"/"Mic") becomes their real name, everything
 * else the "Unknown Speaker" placeholder. Channel labels never leak onward.
 */
export function mapPreviewSpeaker(speaker: string, userName: string): string {
  const key = speaker.trim().toLowerCase();
  if (key === 'you' || key === 'mic') return userName.trim().slice(0, 80) || 'You';
  return UNKNOWN_SPEAKER;
}
