// src/services/session.ts — the persisted half of the daily unlock (plans/0021
// decision 14). The master key is wrapped with a fresh AES-GCM key generated
// non-extractable, and both are stored: the device key can only be used by this
// origin's code, never exported, so the stored row alone is useless elsewhere.
// Anything that fails here (a browser that cannot store a CryptoKey) leaves the
// session in memory only — a relaunch then asks again, which is safe.
import { sessionRepo } from '../data/repositories';

// Each takes the account it is for (the active one when none is named): the wrapping is asynchronous, and a switch of
// account within milliseconds of unlocking must not carry the wrapped key into the other account's store (mw-9rp4hu.5).
export async function persistSession(key: Uint8Array, expiresAt: number, accountId?: string): Promise<boolean> {
  try {
    const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, key as BufferSource);
    await sessionRepo.save({ deviceKey, iv, ciphertext, expiresAt }, accountId);
    return true;
  } catch {
    await clearSession(accountId);
    return false;
  }
}

export async function restoreSession(now: number = Date.now(), accountId?: string): Promise<{ key: Uint8Array; expiresAt: number } | null> {
  try {
    const row = await sessionRepo.get(accountId);
    if (!row) return null;
    if (now >= row.expiresAt) {
      await clearSession(accountId);
      return null;
    }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, row.deviceKey, row.ciphertext);
    return { key: new Uint8Array(plain), expiresAt: row.expiresAt };
  } catch {
    await clearSession(accountId);
    return null;
  }
}

export async function clearSession(accountId?: string): Promise<void> {
  try {
    await sessionRepo.clear(accountId);
  } catch {
    // Nothing stored, or storage unavailable: either way there is no session.
  }
}
