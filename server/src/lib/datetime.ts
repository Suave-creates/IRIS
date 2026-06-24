/**
 * Calendar datetimes are stored as UTC wall-clock in MySQL DATETIME columns and
 * returned as "YYYY-MM-DD HH:MM:SS" (dateStrings: true). These two helpers are exact
 * inverses and keep the round-trip unambiguous so events render at the correct time.
 */

/** ISO-8601 instant → MySQL UTC DATETIME string ("YYYY-MM-DD HH:MM:SS"). */
export function isoToMysqlUtc(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * MySQL UTC wall-clock string → unambiguous ISO-8601 Z. Browsers parse a bare
 * "YYYY-MM-DD HH:MM:SS" ambiguously (often as local time, or not at all), which made
 * events collapse to the grid's start hour — appending Z fixes it. Already-ISO and
 * unparseable inputs pass through unchanged.
 */
export function mysqlUtcToIso(dt: string): string {
  if (!dt) return dt;
  const d = new Date(/[TZ]/.test(dt) ? dt : `${dt.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? dt : d.toISOString();
}
