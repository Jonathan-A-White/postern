// src/services/keySession.ts — the unwrapped key, shared by every screen, for a
// day (plans/0021 decision 14, the Governor 2026-09-28: "passkey unlock once a
// day"; this replaces mw-tfne4.23's 15 minutes, never persisted).
//
// In memory it is a module variable. So that a relaunched PWA does not ask
// again, src/services/session.ts keeps it wrapped with a non-extractable AES
// key this device generated — usable by this origin, never readable out of
// IndexedDB — until the day is up or he locks.
import { clearSession, persistSession, restoreSession } from './session';

export const SESSION_HOURS = 24;
export const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;
/** Kept for the screens and tests that speak in minutes. */
export const SESSION_MINUTES = SESSION_HOURS * 60;

interface Session {
  key: Uint8Array;
  expiresAt: number;
}

let session: Session | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called whenever the key is set or dropped, for the app to re-render. */
export function onKeyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Holds `key` for the rest of the day and keeps it across relaunches. */
export function setKey(key: Uint8Array, expiresAt: number = Date.now() + SESSION_MS): void {
  session = { key, expiresAt };
  void persistSession(key, expiresAt);
  emit();
}

/** The unlocked key, or null when there is none or the day is up. */
export function getKey(): Uint8Array | null {
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    session = null;
    void clearSession();
    emit();
    return null;
  }
  return session.key;
}

export function sessionExpiresAt(): number | null {
  return getKey() ? (session?.expiresAt ?? null) : null;
}

/** Ends the session here and on disk: the next use asks for the fingerprint. */
export function lock(): void {
  const had = session !== null;
  session = null;
  void clearSession();
  if (had) emit();
}

/** On launch: takes back a session kept from earlier today, if there is one. */
export async function resumeSession(): Promise<boolean> {
  if (getKey()) return true;
  const restored = await restoreSession();
  if (!restored) return false;
  session = { key: restored.key, expiresAt: restored.expiresAt };
  emit();
  return true;
}
