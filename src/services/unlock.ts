// src/services/unlock.ts — the one way the cockpit opens the vault: with the
// passkey's PRF secret (a fingerprint) or, where the phone has no PRF, the
// recovery phrase. Either way the key is handed to keySession, which keeps it for
// the day (plans/0021 decision 14).
import type { VaultRow } from '../data/db';
import { setKey } from './keySession';
import { deriveAesKeyFromPhrase, deriveAesKeyFromPrf, findInvalidWords, unwrapKey } from './vault';
import { describeUnlockError, getPrfSecret } from './webauthnPrf';

export async function unlockWithPasskey(vault: VaultRow): Promise<Uint8Array> {
  try {
    if (!vault.credentialId) throw new Error('No passkey is registered for this key.');
    const secret = await getPrfSecret(vault.credentialId);
    if (!secret) throw new Error('The passkey did not return a PRF secret.');
    const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, await deriveAesKeyFromPrf(secret));
    setKey(key);
    return key;
  } catch (err) {
    throw new Error(describeUnlockError(err));
  }
}

export async function unlockWithPhrase(vault: VaultRow, phrase: string): Promise<Uint8Array> {
  const invalid = findInvalidWords(phrase);
  if (invalid.length > 0) {
    throw new Error(invalid.length === 1 ? `“${invalid[0]}” is not a recovery word.` : `These are not recovery words: ${invalid.join(', ')}.`);
  }
  if (!vault.salt) throw new Error('No recovery salt is stored for this key.');
  try {
    const key = await unwrapKey({ ciphertext: vault.ciphertext, iv: vault.iv }, await deriveAesKeyFromPhrase(phrase, vault.salt));
    setKey(key);
    return key;
  } catch {
    throw new Error('That recovery phrase did not unlock the key.');
  }
}
