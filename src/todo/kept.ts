// src/todo/kept.ts — what the To do board keeps on the phone (localStorage): whether he has opened Later and Let go (mw-ht6gsw.5), and which cards
// he has tapped into Today (and on which day). Both survive a reload; a phone that will not keep them shows the defaults (Later and Let go
// folded; nothing tapped), no harm.
import { dayKey } from './due';
import type { TodayPicks } from './lists';

const FOLDS_KEY = 'postern.todo.folds';
const TODAY_KEY = 'postern.todo.today';

/** The two folded rows of the board. */
export type FoldedRow = 'later' | 'let-go';

/** What he has chosen for the folded rows: true is open, false folded; a row not in it is at its default (folded). */
export type RowsOpen = Readonly<Partial<Record<FoldedRow, boolean>>>;

function read(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function write(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // see the top of the file
  }
}

/** Later and Let go are folded until he opens them. */
export function isRowOpen(open: RowsOpen, row: FoldedRow): boolean {
  return open[row] ?? false;
}

export function readRowsOpen(): RowsOpen {
  const stored = read(FOLDS_KEY);
  const out: Partial<Record<FoldedRow, boolean>> = {};
  for (const row of ['later', 'let-go'] as const) {
    if (typeof stored[row] === 'boolean') out[row] = stored[row];
  }
  return out;
}

/** The rows with one row set open or folded; kept on the phone. */
export function keepRowOpen(was: RowsOpen, row: FoldedRow, open: boolean): RowsOpen {
  const next = { ...was, [row]: open };
  write(FOLDS_KEY, next);
  return next;
}

/** The cards tapped into Today on `now`'s day; a tap of another day is no longer one. */
export function readTodayPicks(now: number = Date.now()): TodayPicks {
  const today = dayKey(now);
  return Object.fromEntries(Object.entries(read(TODAY_KEY)).filter(([, day]) => day === today)) as TodayPicks;
}

/** The picks with `card` tapped into Today on `now`'s day (or, with `into` false, put back); the other days' taps are dropped. Kept on the phone. */
export function keepTodayPick(card: string, into: boolean, now: number = Date.now()): TodayPicks {
  const picks: Record<string, string> = { ...readTodayPicks(now) };
  if (into) picks[card] = dayKey(now);
  else delete picks[card];
  write(TODAY_KEY, picks);
  return picks;
}
