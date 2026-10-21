// src/data/dbTrouble.ts — what is wrong with the local database, in a form the door can show (mw-4gkijo.1).
// `blocked`: another window of Postern holds an older copy open and the upgrade waits on it.
// `changed`: another window upgraded the database under this one, which has let go of it; the page reloads once.
// Not imported by the service worker (which shares db.ts but has no page to reload), so it is not in db.ts itself.
import { db } from './db';
import { reloadPage } from '../nav/reload';

export type DbTrouble = 'blocked' | 'changed';

export const RELOAD_AFTER_MS = 1500;
const RELOADED_KEY = 'postern:db-reloaded-at';
const RELOAD_ONCE_MS = 60_000;

let trouble: DbTrouble | null = null;
const listeners = new Set<() => void>();

function set(next: DbTrouble | null): void {
  if (trouble === next) return;
  trouble = next;
  for (const listener of listeners) listener();
}

export function getDbTrouble(): DbTrouble | null {
  return trouble;
}

export function onDbTrouble(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteDbBlocked(): void {
  if (trouble !== 'changed') set('blocked');
}

/** The database opened after all. */
export function clearDbTrouble(): void {
  set(null);
}

/** Another window changed the database under this one: say so, and reload once (not again within a minute, so a loop cannot start). */
export function noteDbChanged(): void {
  set('changed');
  let reloaded = 0;
  try {
    reloaded = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
  } catch {
    // No session storage: reload once and take the chance.
  }
  if (Date.now() - reloaded < RELOAD_ONCE_MS) return;
  try {
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    // As above.
  }
  // The timer outlives a test file's page: it fires with no window left (tests/unit/timers-after-teardown.test.ts).
  setTimeout(() => {
    if (typeof window !== 'undefined') reloadPage();
  }, RELOAD_AFTER_MS);
}

/** Forgets the trouble and the once-only mark (tests). */
export function resetDbTrouble(): void {
  set(null);
  try {
    sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // Nothing to forget.
  }
}

db.on('blocked', () => noteDbBlocked());
// A copy another window has upgraded is let go (closed for good, so nothing reopens it at the old version; returning false stops Dexie's own handler) and the page reloads once.
db.on('versionchange', () => {
  db.close();
  noteDbChanged();
  return false;
});
