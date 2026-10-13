// src/todo/due.ts — a To do card's due time (mw-ev7oyy.9), pure: how it reads on the card's face
// ('Today 17:00', 'Tue 9:00'), when it is past, how it turns into and out of a date-time input's
// value (the phone's own zone) and the UTC time a todo_edit carries, and the order 'Sort by due' gives.
import type { TodoCard } from './lists';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** A due time as milliseconds, or undefined when it is empty or no time. */
function dueMs(due: string | undefined): number | undefined {
  if (!due) return undefined;
  const ms = Date.parse(due);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The whole days from `now`'s calendar day to `at`'s, in the phone's zone. */
function daysFrom(now: number, at: Date): number {
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day(at) - day(new Date(now))) / DAY_MS);
}

/** The due time as it reads on the card: 'Today 17:00', 'Tomorrow 9:00', 'Yesterday 18:30', 'Thu 9:00' (two to six days
 * ahead), else 'Oct 20 9:00' (with the year when it is not this year). Empty when `due` is no time. */
export function formatDue(due: string, now: number): string {
  const ms = dueMs(due);
  if (ms === undefined) return '';
  const at = new Date(ms);
  const clock = `${at.getHours()}:${pad(at.getMinutes())}`;
  const days = daysFrom(now, at);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days === -1) return `Yesterday ${clock}`;
  if (days >= 2 && days <= 6) return `${WEEKDAYS[at.getDay()]} ${clock}`;
  const year = at.getFullYear() === new Date(now).getFullYear() ? '' : ` ${at.getFullYear()}`;
  return `${MONTHS[at.getMonth()]} ${at.getDate()}${year} ${clock}`;
}

/** True from the minute the due time arrives. */
export function isPastDue(due: string, now: number): boolean {
  const ms = dueMs(due);
  return ms !== undefined && ms <= now;
}

/** A due time as the value a datetime-local input takes ('2026-10-13T17:00', the phone's zone); '' for none. */
export function dueToInput(due: string | undefined): string {
  const ms = dueMs(due);
  if (ms === undefined) return '';
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A datetime-local value as the UTC time a todo_edit carries; undefined when it is empty or half typed. */
export function inputToDue(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Earliest due first; a card with no due after every card that has one; equal otherwise. */
export function byDue(a: TodoCard, b: TodoCard): number {
  const first = dueMs(a.due);
  const second = dueMs(b.due);
  if (first === undefined || second === undefined) return first === second ? 0 : first === undefined ? 1 : -1;
  return first - second;
}

/** The cards in due order; the cards given are not changed, and equal ones keep their order. */
export function sortByDue(cards: readonly TodoCard[]): TodoCard[] {
  return [...cards].sort(byDue);
}
