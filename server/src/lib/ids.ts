import { customAlphabet } from 'nanoid';

// URL-safe, unambiguous alphabet (no look-alike chars). 21 chars ≈ collision-safe.
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz';
const generate = customAlphabet(alphabet, 21);

/**
 * Generates a prefixed, sortable-enough unique id, e.g. `id('usr')` → `usr_x7k...`.
 * Prefixes make ids self-describing in logs and the database.
 */
export function id(prefix: string): string {
  return `${prefix}_${generate()}`;
}

/** A bare request/correlation id (no prefix). */
export function requestId(): string {
  return generate();
}
