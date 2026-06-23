import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

// ── Password hashing (scrypt; no native deps) ───────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

/** Hashes a password → `scrypt$<saltB64>$<hashB64>`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = await scrypt(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Verifies a password against a stored hash in constant time. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64');
  const expected = Buffer.from(parts[2]!, 'base64');
  const actual = await scrypt(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Symmetric encryption for connector tokens (AES-256-GCM) ──────────────────

const IV_BYTES = 12;

function getKey(): Buffer {
  const hex = env.TOKEN_ENCRYPTION_KEY;
  if (hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars) to encrypt secrets.');
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypts a UTF-8 string → base64(`iv | authTag | ciphertext`). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypts a value produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + 16);
  const ct = buf.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Cryptographically-random URL-safe token (PKCE verifier, state, etc.). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
