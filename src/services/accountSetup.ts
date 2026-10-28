// src/services/accountSetup.ts — adding an account by its backend's address (mw-9rp4hu.5): which key it signs with (this phone's own,
// a new one made at its door, or one pasted as a recovery phrase), then the licence check against that backend (GET /api/me, signed
// with the key) before anything is kept. A new key cannot be checked yet: its account opens at the door, and the check is the live
// connection's the first time it is unlocked.
import { accountDb, type VaultRow } from '../data/db';
import { DEFAULT_KEY_REF, vaultRepo, type Account } from '../data/repositories';
import { accountNameFor, addAccount, newAccountId, normalizeBackendUrl } from './accounts';
import { getKey, sessionExpiresAt, setKeyFor } from './keySession';
import { fetchMe, NoLicenceError } from './me';
import { deriveAesKeyFromPhrase, deriveMasterKey, findInvalidWords, isValidMnemonic, publicKeyHexFromMasterKey, wrapKey } from './vault';

export type KeyChoice = { kind: 'same' } | { kind: 'new' } | { kind: 'pasted'; phrase: string };

export interface AddAccountInput {
  name: string;
  backendUrl: string;
  key: KeyChoice;
}

/** What the backend said of the key: it knows it and a licence is held; it says no licence is held; or the key could not be checked now. */
export type BackendCheck = 'licensed' | 'no-licence' | 'unchecked';

export interface AddedAccount {
  account: Account;
  check: BackendCheck;
  /** Whether the new account opens already unlocked (a key chosen while this phone is unlocked, or a phrase pasted). */
  unlocked: boolean;
}

export interface AddAccountOptions {
  fetchImpl?: typeof fetch;
}

type VaultFields = Omit<VaultRow, 'id'>;

function withoutId(row: VaultRow): VaultFields {
  const copy: Partial<VaultRow> = { ...row };
  delete copy.id;
  return copy as VaultFields;
}

async function pastedKey(phrase: string): Promise<{ key: Uint8Array; row: VaultFields }> {
  const invalid = findInvalidWords(phrase);
  if (invalid.length > 0) throw new Error(invalid.length === 1 ? `“${invalid[0]}” is not a recovery word.` : `These are not recovery words: ${invalid.join(', ')}.`);
  if (!isValidMnemonic(phrase)) throw new Error('That is not a valid recovery phrase.');
  const key = await deriveMasterKey(phrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapped = await wrapKey(key, await deriveAesKeyFromPhrase(phrase, salt));
  return { key, row: { mode: 'phrase', ciphertext: wrapped.ciphertext, iv: wrapped.iv, salt, publicKeyHex: publicKeyHexFromMasterKey(key) } };
}

/** Adds an account and says what the backend made of its key. Nothing is kept when the backend cannot be reached or the phrase is wrong. */
export async function addAccountByUrl(input: AddAccountInput, options: AddAccountOptions = {}): Promise<AddedAccount> {
  const backendUrl = normalizeBackendUrl(input.backendUrl);
  const name = accountNameFor(input.name, backendUrl);

  let key: Uint8Array | null = null;
  let vaultRow: VaultFields | undefined;
  let expiresAt: number | undefined;
  if (input.key.kind === 'same') {
    const row = await vaultRepo.get();
    if (!row) throw new Error("This phone has no key yet, so there is none to use. Choose a new key or paste one.");
    vaultRow = withoutId(row);
    key = getKey();
    expiresAt = sessionExpiresAt() ?? undefined;
  } else if (input.key.kind === 'pasted') {
    const pasted = await pastedKey(input.key.phrase);
    key = pasted.key;
    vaultRow = pasted.row;
  }

  let check: BackendCheck = 'unchecked';
  if (key) {
    try {
      await fetchMe({ key, apiBase: backendUrl, fetchImpl: options.fetchImpl });
      check = 'licensed';
    } catch (err) {
      if (err instanceof NoLicenceError) check = 'no-licence';
      else throw new Error(`Could not check the key with ${backendUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const id = newAccountId();
  if (vaultRow) await accountDb(id).vault.put({ id: DEFAULT_KEY_REF, ...vaultRow });
  const account = await addAccount({ id, name, backendUrl, keyRef: DEFAULT_KEY_REF });
  if (key) setKeyFor(id, key, expiresAt);
  return { account, check, unlocked: key !== null };
}
