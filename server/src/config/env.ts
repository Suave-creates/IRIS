import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Loads `.env` from the repository root regardless of the working directory
 * the server is launched from (npm workspace scripts run with cwd = `server/`).
 */
function loadDotenv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')];
  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path });
      break;
    }
  }
  // No file found — rely on real environment variables (e.g. in containers).
  if (!candidates.some((p) => existsSync(p))) dotenv.config();

  // Accept GMAIL_* as aliases for GOOGLE_* (one OAuth client powers SSO and the
  // Google connectors). This matches how the credentials were provided.
  process.env.GOOGLE_CLIENT_ID ||= process.env.GMAIL_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET ||= process.env.GMAIL_CLIENT_SECRET;
}

loadDotenv();

const csv = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

/**
 * A comma-separated domain list, tolerant of common hand-edited formats:
 * `a, b`, `[a, b]`, `"a","b"`. Strips brackets/quotes/whitespace and lowercases.
 */
const domainList = z.string().transform((s) =>
  s
    .replace(/[[\]"']/g, '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

/**
 * Default python interpreter for local Whisper transcription. The server runs
 * with cwd = `server/` (npm workspace) or the repo root — probe both, and fall
 * back to the server-relative path when the venv has not been created yet.
 */
function defaultWhisperPython(): string {
  const candidates = [
    resolve(process.cwd(), 'whisper', '.venv', 'Scripts', 'python.exe'),
    resolve(process.cwd(), 'server', 'whisper', '.venv', 'Scripts', 'python.exe'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    APP_BASE_URL: z.string().url().default('http://localhost:8080'),
    WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: csv.default('http://localhost:5173,http://localhost:8080'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_USER: z.string().min(1).default('root'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().min(1).default('IRIS'),
    DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

    /** Gemini API key — when set, meeting audio is transcribed by Gemini (best for Hinglish). */
    GEMINI_API_KEY: z.string().default(''),
    /** Gemini model for audio transcription. */
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    /** ffmpeg binary used to transcode recorder WebM/Opus → WAV for Gemini. */
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),

    /** Python interpreter of the faster-whisper venv (server/whisper/.venv). */
    WHISPER_PYTHON: z.string().min(1).default(defaultWhisperPython()),
    /** Whisper model id passed to transcribe.py (accuracy over speed). */
    WHISPER_MODEL: z.string().min(1).default('large-v3'),

    SESSION_SECRET: z.string().default('dev-insecure-session-secret-change-me'),
    TOKEN_ENCRYPTION_KEY: z.string().default(''),

    // Auth
    COOKIE_NAME: z.string().default('iris_session'),
    OAUTH_COOKIE_NAME: z.string().default('iris_oauth'),
    /**
     * Override the `Secure` flag on session/OAuth cookies. Defaults to true in
     * production (HTTPS). Set false for a plain-HTTP LAN deployment, or the
     * browser drops the cookie and login silently fails.
     */
    COOKIE_SECURE: boolish.optional(),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    AUTH_PASSWORD_ENABLED: boolish.default('false'),
    /** Restrict SSO sign-in to these email domains. Empty = allow any domain. */
    AUTH_ALLOWED_DOMAINS: domainList.default(''),

    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().default('http://localhost:8080/api/auth/google/callback'),
    /** Connector authorization callback (must be registered in the Google OAuth client). */
    GOOGLE_CONNECTOR_REDIRECT_URI: z.string().default('http://localhost:8080/api/connectors/google/callback'),

    /** Background worker loop (token refresh, health, scheduled sync). Disable in tests. */
    WORKERS_ENABLED: boolish.default('true'),

    // Seed (local/dev convenience)
    SEED_OWNER_EMAIL: z.string().default('owner@demo.local'),
    SEED_OWNER_NAME: z.string().default('Demo Owner'),
    SEED_OWNER_PASSWORD: z.string().default('iris-demo-password'),
    SEED_TENANT_NAME: z.string().default('Demo Workspace'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.SESSION_SECRET === 'dev-insecure-session-secret-change-me' || env.SESSION_SECRET.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SESSION_SECRET'],
          message: 'SESSION_SECRET must be a strong random value (≥16 chars) in production.',
        });
      }
      if (env.TOKEN_ENCRYPTION_KEY.length !== 64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TOKEN_ENCRYPTION_KEY'],
          message: 'TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars) in production.',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv();

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

/**
 * Whether auth cookies carry the `Secure` flag. HTTPS-only in production by
 * default; `COOKIE_SECURE=false` relaxes it for plain-HTTP LAN deployments.
 */
export const cookieSecure = env.COOKIE_SECURE ?? isProd;

/** True when a Google OAuth client is configured (gates SSO + Google connectors). */
export const hasGoogleOAuth = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/** True when an Anthropic key is present (gates the AI/context engine). */
export const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);

/** True when a Gemini key is present (preferred meeting-audio transcription engine). */
export const hasGemini = Boolean(env.GEMINI_API_KEY);
