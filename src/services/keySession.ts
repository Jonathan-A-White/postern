// src/services/keySession.ts — the unwrapped BSV key, shared across every
// screen for a limited time so one fingerprint unlock carries to the next
// screen instead of prompting again (mw-tfne4.23, the Governor: 'yes to
// secure key cache shared between screens (not persisted)', 'yes 15 min').
// Held in a module variable only: never Dexie, never localStorage or
// sessionStorage — a fresh page load always starts with no session and
// prompts again.
export const SESSION_MINUTES = 15;
const SESSION_MS = SESSION_MINUTES * 60 * 1000;

interface Session {
  key: Uint8Array;
  lastUse: number;
}

let session: Session | null = null;
let hiddenAt: number | null = null;

export function setKey(key: Uint8Array): void {
  session = { key, lastUse: Date.now() };
}

/** The unlocked key, or null when there is none or the session window has
 * elapsed since it was last used. A successful call refreshes last-use, so
 * every screen that keeps asking for the key keeps the session alive. */
export function getKey(): Uint8Array | null {
  if (!session) return null;
  if (Date.now() - session.lastUse > SESSION_MS) {
    session = null;
    return null;
  }
  session.lastUse = Date.now();
  return session.key;
}

export function lock(): void {
  session = null;
  hiddenAt = null;
}

// Proactively drops the key as soon as the app has spent more than the
// session window in the background, rather than waiting for the next
// screen to ask for it — the same outcome getKey()'s own expiry would reach
// on its next call, just sooner, so the key spends less time sitting in memory.
function handleVisibilityChange(): void {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  if (hiddenAt !== null && Date.now() - hiddenAt > SESSION_MS) {
    lock();
  }
  hiddenAt = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}
