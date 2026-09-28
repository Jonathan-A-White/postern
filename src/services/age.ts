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

/** The cockpit's relative time (plans/0021): formatAge's words for the last day,
 * then "yesterday", then "N days ago" for a week, then the date itself — a label
 * that never grows past a few characters on a phone row. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < -MINUTE_MS) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (diffMs < DAY_MS) return formatAge(date.toISOString(), now.getTime());
  if (diffMs < 2 * DAY_MS) return 'yesterday';
  if (diffMs < 7 * DAY_MS) return plural(Math.floor(diffMs / DAY_MS), 'day');
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A message's own time of day, "14:05", with the day in front when it was not today. */
export function clockTime(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (now.getTime() - date.getTime() < 7 * DAY_MS) return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}
