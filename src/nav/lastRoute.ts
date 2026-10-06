// src/nav/lastRoute.ts — Postern reopens where he left it (mw-f758y.31). The address he is at
// (a `?v=` query, src/nav/route.ts) is kept on every move, and with the scroll offsets of that
// address (src/nav/scrollMemory.ts) it is what a bare open (the home-screen icon, start_url '/')
// goes back to. An open that names a place (a push tap, a shared link) wins over it. Kept in
// localStorage, not Dexie: the router reads the address synchronously before the first render.
//
// mw-f758y.41: not just the last address but the last 20 he visited (the trail) are kept, and a cold
// open rebuilds the browser's own history from them, so Back walks them as if he never closed the
// app (and, past the oldest, lands on the Map). Every history entry carries its place in the trail
// (history.state.i); the trail is kept up to the entry he is on. Each address also keeps its own scroll
// offsets (readAllScrolls).
import { formatRoute, parseRoute, type Route } from './route';

const ROUTE_KEY = 'postern.lastRoute';
const TRAIL_KEY = 'postern.trail';
const SCROLL_KEY = 'postern.scrolls';

/** How many addresses are kept across a close, and how many have their scroll offsets kept. */
export const KEPT_ADDRESSES = 20;
/** How many entries one page life holds in memory before the oldest are let go. */
const TRAIL_IN_MEMORY = 100;

/** Places that are an answer to one event, not somewhere to come back to: a push's landing, a
 * parked share, the key page. */
const NOT_KEPT: Route['view'][] = ['notice', 'alarm', 'emergency', 'share', 'key'];

/** The offsets of each address that has any, least recently written first. */
type StoredScrolls = Record<string, Record<string, number>>;

/** What the app puts in history.state: `app` says Back stays inside the app; `i` is the entry's place in the trail. */
type EntryState = { app?: boolean; i?: number } | null;

function store(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Whether an address is somewhere to come back to. */
export function isKeptSearch(search: string): boolean {
  if (!search) return false;
  return !NOT_KEPT.includes(parseRoute(search).view);
}

/** Keeps `search` as where he is, unless it is a place not worth returning to. */
export function saveLastRoute(search: string): void {
  recordEntry(search);
  if (!isKeptSearch(search)) return;
  try {
    store()?.setItem(ROUTE_KEY, search);
  } catch {
    // Storage full or refused: he opens on the Map's neighbour, as before.
  }
}

export function readLastRoute(): string | null {
  const saved = store()?.getItem(ROUTE_KEY) ?? null;
  return saved && isKeptSearch(saved) ? saved : null;
}

/** The beads a cold open put back in his history; a bead screen that finds one gone skips it (goBack to the one before). */
const restoredBeads = new Set<string>();

// The trail: the addresses of this app's history entries, oldest first. `trail[i - base]` is the entry
// whose history.state.i is `i`; `cursor` is the entry he is on.
let trail: string[] = [];
let base = 0;
let cursor = -1;

function entryState(): EntryState {
  return window.history.state as EntryState;
}

/** The kept addresses of the trail up to the entry he is on, in order, no two alike in a row. */
function keptTrail(): string[] {
  const kept: string[] = [];
  for (const search of trail.slice(0, cursor - base + 1)) {
    if (isKeptSearch(search) && search !== kept[kept.length - 1]) kept.push(search);
  }
  return kept.slice(-KEPT_ADDRESSES);
}

function persistTrail(): void {
  try {
    store()?.setItem(TRAIL_KEY, JSON.stringify(keptTrail()));
  } catch {
    // Storage full or refused: Back after a reopen has fewer screens to walk.
  }
}

function readTrail(): string[] {
  try {
    const stored = JSON.parse(store()?.getItem(TRAIL_KEY) ?? 'null') as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is string => typeof entry === 'string' && isKeptSearch(entry)).slice(-KEPT_ADDRESSES);
  } catch {
    return [];
  }
}

/** Notes that the entry he is on shows `search` (App calls it on every move): a new entry (one the router
 * just pushed, which nothing has numbered yet) joins the trail and cuts any forward entries; one already numbered (Back, Forward, a
 * replace) only moves the cursor and the address. */
function recordEntry(search: string): void {
  const state = entryState();
  let i: number;
  if (typeof state?.i === 'number') {
    i = state.i;
    if (trail.length === 0 || i < base || i - base >= trail.length) {
      // an entry from before this page's trail: it becomes the trail's start
      trail = [];
      base = i;
    }
  } else {
    i = cursor + 1;
    window.history.replaceState({ ...(state ?? {}), i }, '');
    if (i - base < trail.length) trail.length = i - base;
  }
  trail[i - base] = search;
  cursor = i;
  if (trail.length > TRAIL_IN_MEMORY) {
    trail.shift();
    base += 1;
  }
  persistTrail();
}

/** Starts the trail again (a test's fresh page life). */
export function forgetTrail(): void {
  trail = [];
  base = 0;
  cursor = -1;
  restoredBeads.clear();
}

/** The Map's address: what Back lands on past the oldest kept screen. */
const MAP_SEARCH = formatRoute({ view: 'map' });

/**
 * Called once before the first render. A bare address (no query) is replaced by the last one he was at,
 * and the browser's history is rebuilt from the kept trail so Back walks it; an address that names a place
 * (a push tap, a link) is shown as it is, on top of that same rebuilt history. A reload (the history is
 * still there) only re-learns where in the trail he is.
 */
export function restoreLastRoute(): void {
  forgetTrail();
  const here = window.location.search;
  const named = here !== '';
  let entries = readTrail();
  const legacy = readLastRoute();
  if (entries.length === 0 && legacy) entries = [legacy];

  const state = entryState();
  if (named && typeof state?.i === 'number') {
    // A reload: the browser still has its entries around this one.
    const kept = entries[entries.length - 1] === here ? entries : [...entries, here];
    trail = kept;
    cursor = state.i;
    base = cursor - (kept.length - 1);
    return;
  }

  if (!named && entries.length === 0) return;
  if (named) {
    if (entries.length === 0) return;
    if (entries[entries.length - 1] !== here) entries = [...entries, here];
  }
  // Past the oldest kept screen Back lands on the Map.
  if (parseRoute(entries[0]).view !== 'map') entries = [MAP_SEARCH, ...entries];
  const path = window.location.pathname;
  window.history.replaceState({ i: 0 }, '', `${path}${entries[0]}`);
  for (let i = 1; i < entries.length; i++) window.history.pushState({ app: true, i }, '', `${path}${entries[i]}`);
  trail = entries;
  base = 0;
  cursor = entries.length - 1;
  for (const entry of named ? entries.slice(0, -1) : entries) {
    const route = parseRoute(entry);
    if (route.view === 'bead') restoredBeads.add(route.id);
  }
}

/** True once, when `id` is a bead a cold open put back in his history. */
export function takeRestoredBead(id: string): boolean {
  return restoredBeads.delete(id);
}

export function forgetRestoredBead(): void {
  restoredBeads.clear();
}

function readScrollStore(): StoredScrolls {
  try {
    const stored = JSON.parse(store()?.getItem(SCROLL_KEY) ?? 'null') as unknown;
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as StoredScrolls) : {};
  } catch {
    return {};
  }
}

/** Writes the scroll offsets kept for the address `search` (the keys of `offsets` are `address#slot`,
 * or a bare slot name for a box that keeps its place whatever the address). The last 20 addresses to be
 * written keep theirs. */
export function saveScrolls(offsets: ReadonlyMap<string, number>, search: string): void {
  if (!isKeptSearch(search)) return;
  const own: Record<string, number> = {};
  for (const [key, top] of offsets) {
    if (!key.includes('#') || key.startsWith(`${search}#`)) own[key] = top;
  }
  const all = readScrollStore();
  delete all[search];
  if (Object.keys(own).length > 0) all[search] = own;
  for (const old of Object.keys(all).slice(0, -KEPT_ADDRESSES)) delete all[old];
  try {
    store()?.setItem(SCROLL_KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
}

function numbers(offsets: Record<string, number> | undefined): [string, number][] {
  return Object.entries(offsets ?? {}).filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
}

/** The offsets saved for `search`. */
export function readScrolls(search: string): [string, number][] {
  return numbers(readScrollStore()[search]);
}

/** Every kept offset, those of the address `current` last so its own bare slots win. */
export function readAllScrolls(current: string): [string, number][] {
  const all = readScrollStore();
  return [...Object.keys(all).filter((search) => search !== current).flatMap((search) => numbers(all[search])), ...numbers(all[current])];
}
