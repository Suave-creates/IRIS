import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { SttResult, SttSegment } from './stt.js';

/**
 * Meeting-audio transcription via the Gemini API. Gemini handles Hinglish
 * (code-switched Hindi + English) far better than the browser engine, and
 * unlike local Whisper it needs no native runtime. Gemini's audio API does NOT
 * accept WebM/Opus (the recorder's format), so we transcode to 16 kHz mono WAV
 * with ffmpeg first, upload via the Files API, then ask for a structured,
 * timestamped transcript. Every failure returns null so callers fall back to
 * Whisper and then the browser preview — this can never be worse than before.
 */

const API_ROOT = 'https://generativelanguage.googleapis.com';
const HTTP_TIMEOUT_MS = 90_000;
const GENERATE_TIMEOUT_MS = 8 * 60_000;
const MAX_STATE_POLLS = 40;

/** Compact, speech-grade format Gemini accepts — small uploads, fast. */
const GEMINI_AUDIO_MIME = 'audio/mp3';
/**
 * Under this size we send the audio INLINE in the generateContent request (one
 * round trip, no upload+poll); above it we fall back to the Files API. At the
 * 32 kbps mono encode below, 14 MB is roughly an hour of audio, and its base64
 * stays under Gemini's ~20 MB request cap.
 */
const INLINE_MAX_BYTES = 14 * 1024 * 1024;

const TRANSCRIBE_PROMPT = `You are a meeting transcription engine. Transcribe the attached audio VERBATIM.
Rules:
- The speech mixes Hindi and English (Hinglish). Write Hindi words in Devanagari and English words in Latin script, exactly as spoken. Do NOT translate or paraphrase.
- Group words into COHERENT segments: one complete sentence, or one full speaker turn, per segment. Do NOT emit tiny 2–3 word fragments — combine short mid-sentence pauses into the same segment so the transcript reads as clean, natural sentences, not choppy pieces. Punctuate normally.
- For each segment provide: "start" (seconds from the beginning of the audio, a number), "speaker" (use a real name ONLY if the person is clearly named or introduced in the audio; otherwise "Speaker 1", "Speaker 2", … used consistently), and "text" (the spoken words).
- Transcribe only what is actually audible. Never invent content or filler. If nothing is audible, return an empty "segments" array.`;

/** Gemini structured-output schema (OpenAPI subset). */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    language: { type: 'STRING' },
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          start: { type: 'NUMBER' },
          speaker: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['start', 'text'],
      },
    },
  },
  required: ['segments'],
} as const;

interface GeminiFile {
  uri: string;
  name: string;
  mimeType: string;
  state: string;
}

// ── Response parsing (pure, exported for tests) ──────────────────────────────

/**
 * Merges consecutive fragments into sentence-level lines so the transcript
 * reads as clean sentences, not choppy 2-second pieces (a safety net in case
 * the model still over-segments). Flushes on sentence-ending punctuation
 * (including the Hindi danda) or a hard length cap; keeps the first start time.
 */
export function coalesceSegments(segments: SttSegment[]): SttSegment[] {
  const HARD_CAP = 240;
  const out: SttSegment[] = [];
  let cur: SttSegment | null = null;
  for (const seg of segments) {
    if (!cur) {
      cur = { ...seg };
    } else {
      cur = { start: cur.start, end: seg.end, text: `${cur.text} ${seg.text}`.trim() };
    }
    if (/[.?!।]["')\]]?\s*$/.test(cur.text) || cur.text.length >= HARD_CAP) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Concatenated text of the first candidate's parts, or null. */
function candidateText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== 'object') return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  let text = '';
  for (const part of parts) {
    if (part && typeof part === 'object') {
      const t = (part as { text?: unknown }).text;
      if (typeof t === 'string') text += t;
    }
  }
  const trimmed = text.trim();
  return trimmed || null;
}

/**
 * Parses a Gemini generateContent response into an SttResult. The model returns
 * JSON matching RESPONSE_SCHEMA in the candidate text. Returns null on any shape
 * mismatch. Segments carry only start/end/text (speaker is collapsed into the
 * channel model downstream); pure and exported for tests.
 */
export function parseGeminiTranscript(payload: unknown, model: string): SttResult | null {
  const text = candidateText(payload);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rawSegments = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(rawSegments)) return null;
  const segments: SttSegment[] = [];
  for (const raw of rawSegments) {
    if (!raw || typeof raw !== 'object') continue;
    const seg = raw as Record<string, unknown>;
    const start = typeof seg.start === 'number' && Number.isFinite(seg.start) ? Math.max(0, seg.start) : null;
    const segText = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (start === null || !segText) continue;
    segments.push({ start, end: start, text: segText.slice(0, 2000) });
  }
  return { engine: model.slice(0, 40), segments: coalesceSegments(segments) };
}

// ── HTTP + ffmpeg helpers ────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Transcodes any input to a compact 16 kHz mono MP3 (small upload, speech-grade). */
function transcodeForGemini(inputPath: string): Promise<string | null> {
  const outputPath = `${inputPath.replace(/\.[^.]+$/, '')}.gemini.mp3`;
  const args = ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', outputPath];
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(env.FFMPEG_PATH, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      logger.warn({ err }, 'ffmpeg failed to spawn — is it installed / FFMPEG_PATH set?');
      resolve(null);
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      logger.warn({ err }, 'ffmpeg process error — skipping Gemini transcription');
      resolve(null);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ code, stderr: stderr.slice(-300) }, 'ffmpeg transcode failed');
        resolve(null);
        return;
      }
      resolve(outputPath);
    });
  });
}

async function uploadFile(bytes: Buffer, mimeType: string, key: string): Promise<GeminiFile | null> {
  const start = await fetchWithTimeout(
    `${API_ROOT}/upload/v1beta/files?key=${key}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'iris-meeting-audio' } }),
    },
    HTTP_TIMEOUT_MS,
  );
  if (!start.ok) {
    const body = await start.text().catch(() => '');
    logger.warn({ status: start.status, body: body.slice(0, 500) }, 'gemini file upload (start) failed');
    return null;
  }
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) return null;

  const upload = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Length': String(bytes.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: bytes,
    },
    HTTP_TIMEOUT_MS,
  );
  if (!upload.ok) {
    logger.warn({ status: upload.status }, 'gemini file upload (finalize) failed');
    return null;
  }
  const json = (await upload.json()) as { file?: GeminiFile };
  return json.file ?? null;
}

/** Waits for an uploaded file to become ACTIVE (audio is processed async). */
async function waitActive(file: GeminiFile, key: string): Promise<GeminiFile | null> {
  let current = file;
  for (let i = 0; i < MAX_STATE_POLLS && current.state !== 'ACTIVE'; i++) {
    if (current.state === 'FAILED') return null;
    await sleep(1000);
    const res = await fetchWithTimeout(`${API_ROOT}/v1beta/${current.name}?key=${key}`, { method: 'GET' }, HTTP_TIMEOUT_MS);
    if (!res.ok) return null;
    current = (await res.json()) as GeminiFile;
  }
  return current.state === 'ACTIVE' ? current : null;
}

/** Runs generateContent with the given audio part (inline or file reference). */
async function generate(audioPart: Record<string, unknown>, model: string, key: string): Promise<SttResult | null> {
  const res = await fetchWithTimeout(
    `${API_ROOT}/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [audioPart, { text: TRANSCRIBE_PROMPT }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    },
    GENERATE_TIMEOUT_MS,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.warn({ status: res.status, model, body: body.slice(0, 700) }, 'gemini generateContent failed');
    return null;
  }
  const raw: unknown = await res.json();
  const result = parseGeminiTranscript(raw, model);
  if (!result || result.segments.length === 0) {
    // No usable transcript — surface the raw envelope (safety block? empty? error?).
    logger.warn({ preview: JSON.stringify(raw).slice(0, 700) }, 'gemini returned no usable transcript segments');
    return null;
  }
  return result;
}

async function deleteFile(name: string, key: string): Promise<void> {
  try {
    await fetchWithTimeout(`${API_ROOT}/v1beta/${name}?key=${key}`, { method: 'DELETE' }, HTTP_TIMEOUT_MS);
  } catch {
    /* best-effort cleanup — files auto-expire after 48h anyway */
  }
}

/**
 * Transcribes one recorded audio file with Gemini. Returns null (never throws)
 * when Gemini isn't configured, ffmpeg is unavailable, or any API step fails —
 * callers then fall back to Whisper / the browser preview.
 */
export async function transcribeWithGemini(filePath: string): Promise<SttResult | null> {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const model = env.GEMINI_MODEL;

  let audioPath: string | null = null;
  try {
    audioPath = await transcodeForGemini(filePath);
    if (!audioPath) return null;
    const bytes = await readFile(audioPath);

    // Fast path: small enough to inline in one request (no upload + polling).
    if (bytes.length <= INLINE_MAX_BYTES) {
      return await generate({ inlineData: { mimeType: GEMINI_AUDIO_MIME, data: bytes.toString('base64') } }, model, key);
    }

    // Large audio: upload via the Files API, wait for it to process, then reference it.
    const uploaded = await uploadFile(bytes, GEMINI_AUDIO_MIME, key);
    if (!uploaded) return null;
    const active = await waitActive(uploaded, key);
    if (!active) {
      await deleteFile(uploaded.name, key);
      return null;
    }
    const result = await generate({ fileData: { mimeType: active.mimeType, fileUri: active.uri } }, model, key);
    await deleteFile(active.name, key);
    return result;
  } catch (err) {
    logger.warn({ err, filePath }, 'gemini transcription failed');
    return null;
  } finally {
    if (audioPath) await unlink(audioPath).catch(() => undefined);
  }
}
