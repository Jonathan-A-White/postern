// src/nav/lastRoute.ts — Postern reopens where he left it (mw-f758y.31). The address he is at
// (a `?v=` query, src/nav/route.ts) is kept on every move, and with the scroll offsets of that
// address (src/nav/scrollMemory.ts) it is what a bare open (the home-screen icon, start_url '/')
// goes back to. An open that names a place (a push tap, a shared link) wins over it. Kept in
// localStorage, not Dexie: the router reads the address synchronously before the first render.
import { parseRoute, type Route } from './route';

const ROUTE_KEY = 'postern.lastRoute';
const SCROLL_KEY = 'postern.lastScroll';

/** Places that are an answer to one event, not somewhere to come back to: a push's landing, a
 * parked share, the key page. */
const NOT_KEPT: Route['view'][] = ['notice', 'alarm', 'share', 'key'];

type StoredScroll = { search: string; offsets: Record<string, number> };

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

/** The bead a cold open put him back at; the bead screen goes to the Map if it turns out not to exist. */
let restoredBead: string | undefined;

/** Called once before the first render: a bare address (no query) is replaced by the saved one. */
export function restoreLastRoute(): void {
  if (window.location.search !== '') return;
  const saved = readLastRoute();
  if (!saved) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${saved}`);
  const route = parseRoute(saved);
  restoredBead = route.view === 'bead' ? route.id : undefined;
}

/** True once, when `id` is the bead a cold open restored. */
export function takeRestoredBead(id: string): boolean {
  if (restoredBead !== id) return false;
  restoredBead = undefined;
  return true;
}

export function forgetRestoredBead(): void {
  restoredBead = undefined;
}

/** Writes the scroll offsets kept for the address he is at (the keys of `offsets` are `address#slot`,
 * or a bare slot name for a box that keeps its place whatever the address). */
export function saveScrolls(offsets: ReadonlyMap<string, number>, search: string): void {
  if (!isKeptSearch(search)) return;
  const own: Record<string, number> = {};
  for (const [key, top] of offsets) {
    if (!key.includes('#') || key.startsWith(`${search}#`)) own[key] = top;
  }
  try {
    store()?.setItem(SCROLL_KEY, JSON.stringify({ search, offsets: own } satisfies StoredScroll));
  } catch {
    // As above.
  }
}

/** The offsets saved for `search`, if they were saved at that address. */
export function readScrolls(search: string): [string, number][] {
  try {
    const stored = JSON.parse(store()?.getItem(SCROLL_KEY) ?? 'null') as StoredScroll | null;
    if (!stored || stored.search !== search) return [];
    return Object.entries(stored.offsets).filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  } catch {
    return [];
  }
}
