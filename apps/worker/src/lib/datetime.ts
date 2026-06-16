/**
 * SQLite's `datetime('now')` returns UTC timestamps in the non-standard
 * "YYYY-MM-DD HH:MM:SS" format (space separator, no "T", no "Z").
 *
 * When such a string is passed to `new Date(...)` in a browser it is
 * interpreted as *local* time, which silently shifts the displayed value.
 * To keep the API contract unambiguous we normalize these values to proper
 * ISO 8601 UTC strings (e.g. "2026-05-29T07:21:52Z") before returning them.
 *
 * Values that are already ISO (contain "T" / "Z" / a timezone offset) are
 * returned untouched.
 */
const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

export function toIsoUtc(value: string): string;
export function toIsoUtc(value: string | null | undefined): string | null;
export function toIsoUtc(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const match = SQLITE_DATETIME.exec(value);
  if (!match) return value;
  return `${match[1]}T${match[2]}Z`;
}
