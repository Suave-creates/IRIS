import { PERSON_CATEGORIES, PERSON_FUNCTIONS, isValidLocation, normalizeLocation } from '@iris/shared';
import type { PersonInput } from '@iris/shared';

/**
 * Bulk roster parsing: turns pasted text into PersonInput rows. Accepts
 *  - the weekly-planner's JS `P` array entries, e.g.
 *      {n:'Raj Pandey', c:'Direct', f:'Operations', fr:'Daily', l:'BWD', d:[1,2,3,4,5]},
 *    (trailing comments, the whole <script>, or the entire HTML file all work)
 *  - a JSON array using either short (n/c/f/l/d) or long (name/category/func/location/days) keys.
 * `fr` (cadence) is ignored — cadence always derives from the day count.
 */

export interface ParsedRoster {
  people: PersonInput[];
  /** Human-readable problems: rows that were dropped or repaired, in input order. */
  issues: string[];
}

/** Case/spacing-tolerant lookup into a closed union set, returning the canonical value. */
function canonical<T extends string>(raw: string, values: readonly T[]): T | null {
  const needle = raw.trim().toLowerCase();
  return values.find((v) => v.toLowerCase() === needle) ?? null;
}

interface RawEntry {
  name?: unknown;
  category?: unknown;
  func?: unknown;
  location?: unknown;
  days?: unknown;
}

/** Accepts short planner keys and long keys, first one present wins. */
function fromRecord(rec: Record<string, unknown>): RawEntry {
  return {
    name: rec.n ?? rec.name,
    category: rec.c ?? rec.category ?? rec.cat,
    func: rec.f ?? rec.func ?? rec.function,
    location: rec.l ?? rec.location ?? rec.loc,
    days: rec.d ?? rec.days,
  };
}

function toDays(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const days = list
    // Tolerate quoted values from the loose path (d:['1','2']) and JSON strings.
    .map((v) => (typeof v === 'number' ? v : Number(String(v).replace(/['"\s]/g, ''))))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

function normalizeEntry(raw: RawEntry, index: number, issues: string[]): PersonInput | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const label = name || `entry ${index + 1}`;
  if (!name) {
    issues.push(`Entry ${index + 1}: no name — dropped.`);
    return null;
  }
  const category = canonical(String(raw.category ?? ''), PERSON_CATEGORIES);
  if (!category) {
    issues.push(`${label}: unknown category "${String(raw.category ?? '')}" — dropped.`);
    return null;
  }
  const func = canonical(String(raw.func ?? ''), PERSON_FUNCTIONS);
  if (!func) {
    issues.push(`${label}: unknown function "${String(raw.func ?? '')}" — dropped.`);
    return null;
  }
  // Locations are user-extensible site codes — any 2–12 letter/digit code is valid.
  const location = normalizeLocation(String(raw.location ?? ''));
  if (!isValidLocation(location)) {
    issues.push(`${label}: invalid location "${String(raw.location ?? '')}" (use a 2–12 letter/digit code) — dropped.`);
    return null;
  }
  const days = toDays(raw.days);
  const rawDayCount = Array.isArray(raw.days) ? raw.days.filter((v) => String(v).trim() !== '').length : 0;
  if (rawDayCount > 0 && days.length === 0) {
    issues.push(`${label}: no valid days (must be 1..6) — imported with no days set.`);
  }
  return { name: name.slice(0, 160), category, func, location, days };
}

/**
 * Field extractors for one JS object literal (single or double quotes, with
 * backslash escapes so names like 'D\'Souza' survive).
 */
const FIELD_RES: Record<'n' | 'c' | 'f' | 'l', RegExp> = {
  n: /(?:^|[,{\s])(?:n|name)\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/,
  c: /(?:^|[,{\s])(?:c|category|cat)\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/,
  f: /(?:^|[,{\s])(?:f|func|function)\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/,
  l: /(?:^|[,{\s])(?:l|location|loc)\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/,
};
const DAYS_RE = /(?:^|[,{\s])(?:d|days)\s*:\s*\[([^\]]*)\]/;

/** Resolves backslash escapes captured from a quoted JS string. */
function unescapeJs(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function extractField(re: RegExp, block: string): string | undefined {
  const match = re.exec(block)?.[2];
  return match === undefined ? undefined : unescapeJs(match);
}

/**
 * Scans free text (JS source, a whole HTML file) for planner-style entries.
 * Blocks may contain one level of nested braces (e.g. an extra object field).
 */
function parseLooseEntries(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const block of text.match(/\{(?:[^{}]|\{[^{}]*\})*\}/g) ?? []) {
    const name = extractField(FIELD_RES.n, block);
    if (name === undefined) continue; // CSS rules and other braces have no quoted name field
    const daysRaw = DAYS_RE.exec(block)?.[1];
    entries.push({
      name,
      category: extractField(FIELD_RES.c, block),
      func: extractField(FIELD_RES.f, block),
      location: extractField(FIELD_RES.l, block),
      days: daysRaw !== undefined ? daysRaw.split(',').map((s) => s.trim()) : [],
    });
  }
  return entries;
}

/** Parses pasted roster text into validated PersonInput rows + issues. */
export function parseRoster(text: string): ParsedRoster {
  const issues: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { people: [], issues };

  let raws: RawEntry[] = [];
  try {
    const json: unknown = JSON.parse(trimmed);
    // Accept a bare array, a {people: [...]} wrapper, or a single entry object.
    const list = Array.isArray(json)
      ? json
      : json && typeof json === 'object' && Array.isArray((json as { people?: unknown }).people)
        ? ((json as { people: unknown[] }).people)
        : json && typeof json === 'object'
          ? [json]
          : [];
    raws = list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object').map((e) => fromRecord(e));
  } catch {
    raws = parseLooseEntries(trimmed);
  }
  if (!raws.length) {
    issues.push('No roster entries recognized — paste planner entries like {n:’Name’, c:’Direct’, f:’Operations’, l:’BWD’, d:[1,3]} or a JSON array.');
    return { people: [], issues };
  }

  const people: PersonInput[] = [];
  const seen = new Set<string>();
  raws.forEach((raw, i) => {
    const person = normalizeEntry(raw, i, issues);
    if (!person) return;
    const key = person.name.toLowerCase();
    if (seen.has(key)) {
      issues.push(`${person.name}: duplicated in the paste — keeping the first entry.`);
      return;
    }
    seen.add(key);
    people.push(person);
  });
  return { people, issues };
}
