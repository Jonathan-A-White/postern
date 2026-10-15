// src/todo/kept.ts — what the To do board keeps on the phone (localStorage), for lists.ts's groups (mw-ev7oyy.16): which groups of each list
// he has opened or folded, and which cards he has tapped into Today (and on which day). Both survive a reload; a phone that will not keep
// them shows the defaults (Today open, Soon and Someday folded; nothing tapped), no harm.
import { dayKey } from './due';
import type { TodayPicks, TodoGroup } from './lists';

const GROUPS_KEY = 'postern.todo.groups';
const TODAY_KEY = 'postern.todo.today';

/** What he has chosen for each list's groups: true is open, false folded; a group not in it is at its default. */
export type GroupsOpen = Readonly<Record<string, Partial<Record<TodoGroup, boolean>>>>;

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

/** Today is open when he has not said; Soon and Someday are folded. */
export function isGroupOpen(open: GroupsOpen, list: string, group: TodoGroup): boolean {
  return open[list]?.[group] ?? group === 'today';
}

export function readGroupsOpen(): GroupsOpen {
  const out: Record<string, Partial<Record<TodoGroup, boolean>>> = {};
  for (const [list, groups] of Object.entries(read(GROUPS_KEY))) {
    if (!groups || typeof groups !== 'object') continue;
    const kept: Partial<Record<TodoGroup, boolean>> = {};
    for (const group of ['today', 'soon', 'someday'] as const) {
      const open = (groups as Record<string, unknown>)[group];
      if (typeof open === 'boolean') kept[group] = open;
    }
    out[list] = kept;
  }
  return out;
}

/** The groups with one list's group set open or folded; kept on the phone. */
export function keepGroupOpen(was: GroupsOpen, list: string, group: TodoGroup, open: boolean): GroupsOpen {
  const next = { ...was, [list]: { ...was[list], [group]: open } };
  write(GROUPS_KEY, next);
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
