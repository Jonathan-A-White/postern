// src/services/keySession.ts — the unwrapped key, shared by every screen, for a
// day (plans/0021 decision 14, the Governor 2026-09-28: "passkey unlock once a
// day"; this replaces mw-tfne4.23's 15 minutes, never persisted).
//
// In memory it is a module variable. So that a relaunched PWA does not ask
// again, src/services/session.ts keeps it wrapped with a non-extractable AES
// key this device generated — usable by this origin, never readable out of
// IndexedDB — until the day is up or he locks.
//
// Each account (src/services/accounts.ts) unlocks its own key: the session is the active account's, so
// switching accounts hands back the key that account unlocked, or none, and tells the screens (mw-9rp4hu.4).
import { onAccountChange, onAccountRemoved, getActiveAccount } from './accounts';
import { clearSession, persistSession, restoreSession } from './session';

export const SESSION_HOURS = 24;
export const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
/** Kept for the screens and tests that speak in minutes. */
export const SESSION_MINUTES = SESSION_HOURS * 60;

interface Session {
  key: Uint8Array;
  expiresAt: number;
}

/** Each account's unlocked key, by account id; `getKey` and the rest read the active account's. */
const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const activeId = (): string => getActiveAccount().id;
// A switch of account changes the key the screens see.
onAccountChange(emit);
// An account taken off the list keeps no key in memory.
onAccountRemoved((id) => {
  sessions.delete(id);
});

/** Called whenever the key is set or dropped, for the app to re-render. */
export function onKeyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Holds `key` for the rest of the day and keeps it across relaunches. */
export function setKey(key: Uint8Array, expiresAt: number = Date.now() + SESSION_MS): void {
  setKeyFor(activeId(), key, expiresAt);
}

/** Holds `key` for one account (a key chosen when the account is added unlocks it at once); the store it is kept in is that account's,
 * whichever is active when the wrapping finishes (mw-9rp4hu.5). */
export function setKeyFor(accountId: string, key: Uint8Array, expiresAt: number = Date.now() + SESSION_MS): void {
  sessions.set(accountId, { key, expiresAt });
  void persistSession(key, expiresAt, accountId);
  emit();
}

/** The unlocked key, or null when there is none or the day is up. */
export function getKey(): Uint8Array | null {
  const id = activeId();
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    sessions.delete(id);
    void clearSession(id);
    emit();
    return null;
  }
  return session.key;
}

export function sessionExpiresAt(): number | null {
  return getKey() ? (sessions.get(activeId())?.expiresAt ?? null) : null;
}

/** Ends the session here and on disk: the next use asks for the fingerprint. */
export function lock(): void {
  const id = activeId();
  const had = sessions.delete(id);
  void clearSession(id);
  if (had) emit();
}

/** On launch: takes back a session kept from earlier today, if there is one. */
export async function resumeSession(): Promise<boolean> {
  if (getKey()) return true;
  const id = activeId();
  const restored = await restoreSession(Date.now(), id);
  if (!restored) return false;
  sessions.set(id, { key: restored.key, expiresAt: restored.expiresAt });
  emit();
  return true;
}
