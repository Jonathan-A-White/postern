// src/services/age.ts — a short relative-time label ("2 min ago") for a
// snapshot's or a bead's ISO-8601 timestamp, used by the Projects, Project and
// bead screens.
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function formatAge(iso: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(iso).getTime();
  if (diffMs < MINUTE_MS) return 'just now';
  // "min" stays singular even plural ("2 min ago", not "2 mins ago") — the
  // story's own example.
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)} min ago`;
  if (diffMs < DAY_MS) return plural(Math.floor(diffMs / HOUR_MS), 'hour');
  return plural(Math.floor(diffMs / DAY_MS), 'day');
}
