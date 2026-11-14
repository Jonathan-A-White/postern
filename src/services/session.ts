// src/services/session.ts — the persisted half of the daily unlock (plans/0021
// decision 14). The master key is wrapped with a fresh AES-GCM key generated
// non-extractable, and both are stored: the device key can only be used by this
// origin's code, never exported, so the stored row alone is useless elsewhere.
// Anything that fails here (a browser that cannot store a CryptoKey) leaves the
// session in memory only — a relaunch then asks again, which is safe.
import { sessionRepo } from '../data/repositories';

// Each takes the account it is for (the active one when none is named): the wrapping is asynchronous, and a switch of
// account within milliseconds of unlocking must not carry the wrapped key into the other account's store (mw-9rp4hu.5).
//
// The write is in flight for a few ms on a calm host and seconds on a loaded one, and setKey does not wait for it. So each
// account's write is kept here until it ends, and a read or a clear of that account's row waits for it: a restore that
// races the write meets the key, not the door, and a lock that races it is not undone by the write landing after it
// (mw-6ww.175.60). A page that is killed before the write ends takes its promise with it; nothing here can help that.
const inFlight = new Map<string, Promise<boolean>>();
const slot = (accountId?: string): string => accountId ?? '';

async function afterPersist(accountId?: string): Promise<void> {
  await inFlight.get(slot(accountId))?.catch(() => undefined);
}

export function persistSession(key: Uint8Array, expiresAt: number, accountId?: string): Promise<boolean> {
  const id = slot(accountId);
  const write: Promise<boolean> = writeSession(key, expiresAt, accountId).finally(() => {
    if (inFlight.get(id) === write) inFlight.delete(id);
  });
  inFlight.set(id, write);
  return write;
}

async function writeSession(key: Uint8Array, expiresAt: number, accountId?: string): Promise<boolean> {
  try {
    const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, key as BufferSource);
    await sessionRepo.save({ deviceKey, iv, ciphertext, expiresAt }, accountId);
    return true;
  } catch {
    await clearRow(accountId);
    return false;
  }
}

export async function restoreSession(now: number = Date.now(), accountId?: string): Promise<{ key: Uint8Array; expiresAt: number } | null> {
  await afterPersist(accountId);
  try {
    const row = await sessionRepo.get(accountId);
    if (!row) return null;
    if (now >= row.expiresAt) {
      await clearRow(accountId);
      return null;
    }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, row.deviceKey, row.ciphertext);
    return { key: new Uint8Array(plain), expiresAt: row.expiresAt };
  } catch {
    await clearRow(accountId);
    return null;
  }
}

export async function clearSession(accountId?: string): Promise<void> {
  await afterPersist(accountId);
  await clearRow(accountId);
}

async function clearRow(accountId?: string): Promise<void> {
  try {
    await sessionRepo.clear(accountId);
  } catch {
    // Nothing stored, or storage unavailable: either way there is no session.
  }
}
