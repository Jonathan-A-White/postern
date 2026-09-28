// src/services/session.ts — the persisted half of the daily unlock (plans/0021
// decision 14). The master key is wrapped with a fresh AES-GCM key generated
// non-extractable, and both are stored: the device key can only be used by this
// origin's code, never exported, so the stored row alone is useless elsewhere.
// Anything that fails here (a browser that cannot store a CryptoKey) leaves the
// session in memory only — a relaunch then asks again, which is safe.
import { sessionRepo } from '../data/repositories';

export async function persistSession(key: Uint8Array, expiresAt: number): Promise<boolean> {
  try {
    const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, key as BufferSource);
    await sessionRepo.save({ deviceKey, iv, ciphertext, expiresAt });
    return true;
  } catch {
    await clearSession();
    return false;
  }
}

export async function restoreSession(now: number = Date.now()): Promise<{ key: Uint8Array; expiresAt: number } | null> {
  try {
    const row = await sessionRepo.get();
    if (!row) return null;
    if (now >= row.expiresAt) {
      await clearSession();
      return null;
    }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, row.deviceKey, row.ciphertext);
    return { key: new Uint8Array(plain), expiresAt: row.expiresAt };
  } catch {
    await clearSession();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await sessionRepo.clear();
  } catch {
    // Nothing stored, or storage unavailable: either way there is no session.
  }
}
