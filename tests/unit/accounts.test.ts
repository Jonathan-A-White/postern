// mw-9rp4hu.4: the app keeps more than one account. An Account is {id, name, backendUrl, keyRef, licence,
// ideasOnly}; the app has an active one, and the API client, the unlocked key, the licence, Ideas only and
// every store the cockpit reads (messages, view, cards, outbox…) are the active account's.
// Yesterday's single-account phone becomes account 1, in place.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db, FIRST_ACCOUNT_ID } from '../../src/data/db';
import { settingsRepo, vaultRepo, messagesRepo, accountsRepo } from '../../src/data/repositories';
import { addAccount, loadAccounts, resetAccounts, switchAccount, getActiveAccount, activeBackendUrl, listAccounts, onAccountChange } from '../../src/services/accounts';
import { getKey, lock, setKey } from '../../src/services/keySession';
import { apiFetch } from '../../src/services/apiAuth';
import { getCachedLicenceStatus, type LicenceStatus } from '../../src/services/licence';
import type { IdeasOnlyKept } from '../../src/model/ideasOnly';

vi.mock('../../src/services/session', () => ({
  persistSession: vi.fn(async () => true),
  restoreSession: vi.fn(async () => null),
  clearSession: vi.fn(async () => undefined),
}));

const OLD_KEY = PrivateKey.fromRandom();
const LUKE_KEY = PrivateKey.fromRandom();
const asMaster = (key: PrivateKey): Uint8Array => new Uint8Array(Utils.toArray(key.toHex(), 'hex'));
const NONCE = 'b'.repeat(64);
const LICENCE: LicenceStatus = { held: true, outpoint: { txid: 'c'.repeat(64), vout: 0 }, collection: 'postern', checkedAt: '2026-10-01T00:00:00.000Z' };
const KEPT: IdeasOnlyKept = {
  key: OLD_KEY.toPublicKey().toString(),
  setting: { until: 0, reaches: {} },
  state: { on: false, until: 0, by: '' },
  at: 1_790_000_000_000,
};

/** Yesterday's phone: one vault row, one cached licence, one Ideas only answer, some messages: no accounts anywhere. */
async function yesterdaysPhone(): Promise<void> {
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1, 2, 3]).buffer,
    iv: new Uint8Array([4, 5, 6]),
    salt: new Uint8Array([7, 8]),
    publicKeyHex: OLD_KEY.toPublicKey().toString(),
  });
  await db.settings.put({ key: 'licence-status', value: LICENCE });
  await db.settings.put({ key: 'ideasOnly', value: KEPT });
  await db.messages.put({
    id: 'a'.repeat(64) + ':0', txid: 'a'.repeat(64), vout: 0, seq: 1, class: 'message', to: 'x', from: 'y', ts: 1, ciphertext: 'ab', direction: 'received', read: false,
  });
}

beforeEach(async () => {
  lock();
  await resetAccounts();
  await Promise.all([db.settings.clear(), db.vault.clear(), db.messages.clear()]);
});

describe('an upgrade of yesterday\'s single-account state', () => {
  it('yields one account, active, with the same key and licence', async () => {
    await yesterdaysPhone();

    await loadAccounts();

    const accounts = await listAccounts();
    expect(accounts).toHaveLength(1);
    const [account] = accounts;
    expect(account.id).toBe(FIRST_ACCOUNT_ID);
    expect(getActiveAccount().id).toBe(account.id);
    expect(account.backendUrl).toBe('/api');
    expect(account.licence).toEqual(LICENCE);
    expect(account.ideasOnly).toEqual(KEPT);
    // The key: the account's keyRef is the vault row it signs with, still in place.
    expect((await vaultRepo.get())?.publicKeyHex).toBe(OLD_KEY.toPublicKey().toString());
    expect(account.keyRef).toBe((await vaultRepo.get())?.id);
    expect(await getCachedLicenceStatus()).toEqual(LICENCE);
    expect(await settingsRepo.getIdeasOnly()).toEqual(KEPT);
  });

  it('keeps the phone\'s cache where it was', async () => {
    await yesterdaysPhone();
    await loadAccounts();
    expect(await db.messages.count()).toBe(1);
    expect(await messagesRepo.get('a'.repeat(64) + ':0')).toBeDefined();
  });

  it('is done once: loading again makes no second account', async () => {
    await yesterdaysPhone();
    await loadAccounts();
    await loadAccounts();
    expect(await listAccounts()).toHaveLength(1);
  });

  it('gives a phone with nothing yet the same first account', async () => {
    await loadAccounts();
    const [account] = await listAccounts();
    expect(account.id).toBe(FIRST_ACCOUNT_ID);
    expect(account.licence).toBeUndefined();
    expect(activeBackendUrl()).toBe('/api');
  });
});

describe('switching the active account', () => {
  async function twoAccounts() {
    await yesterdaysPhone();
    await loadAccounts();
    return addAccount({ name: "Luke's factory", backendUrl: 'https://luke.example/api' });
  }

  it('switches the API base URL and the key the client signs with', async () => {
    const luke = await twoAccounts();
    setKey(asMaster(OLD_KEY));
    await switchAccount(luke.id);
    setKey(asMaster(LUKE_KEY));

    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/challenge')) return new Response(JSON.stringify({ nonce: NONCE }), { status: 200 });
      seen.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return new Response('{}', { status: 200 });
    });
    const sign = () => apiFetch('/me', undefined, { unlockedKey: getKey() ?? undefined, fetchImpl });

    await sign();
    expect(activeBackendUrl()).toBe('https://luke.example/api');
    expect(seen.at(-1)?.url).toBe('https://luke.example/api/me');
    expect(seen.at(-1)?.auth).toMatch(new RegExp(`^Postern2 ${LUKE_KEY.toPublicKey().toString()}:`));

    await switchAccount(FIRST_ACCOUNT_ID);
    await sign();
    expect(activeBackendUrl()).toBe('/api');
    expect(seen.at(-1)?.url).toBe('/api/me');
    expect(seen.at(-1)?.auth).toMatch(new RegExp(`^Postern2 ${OLD_KEY.toPublicKey().toString()}:`));
  });

  it('holds each account\'s unlocked key apart: switching hands back the key that account unlocked', async () => {
    const luke = await twoAccounts();
    setKey(asMaster(OLD_KEY));
    await switchAccount(luke.id);
    expect(getKey()).toBeNull();
    setKey(asMaster(LUKE_KEY));
    expect(getKey()).toEqual(asMaster(LUKE_KEY));
    await switchAccount(FIRST_ACCOUNT_ID);
    expect(getKey()).toEqual(asMaster(OLD_KEY));
  });

  it('keeps each account\'s licence, Ideas only, vault and messages apart', async () => {
    const luke = await twoAccounts();
    await switchAccount(luke.id);
    expect(await getCachedLicenceStatus()).toBeUndefined();
    expect(await settingsRepo.getIdeasOnly()).toBeUndefined();
    expect(await vaultRepo.get()).toBeUndefined();
    expect(await db.messages.count()).toBe(0);

    const lukes: IdeasOnlyKept = { ...KEPT, key: LUKE_KEY.toPublicKey().toString(), at: 5 };
    await settingsRepo.setIdeasOnly(lukes);
    await db.messages.put({
      id: 'd'.repeat(64) + ':0', txid: 'd'.repeat(64), vout: 0, seq: 9, class: 'message', to: 'x', from: 'y', ts: 2, ciphertext: 'cd', direction: 'received', read: false,
    });

    await switchAccount(FIRST_ACCOUNT_ID);
    expect(await getCachedLicenceStatus()).toEqual(LICENCE);
    expect(await settingsRepo.getIdeasOnly()).toEqual(KEPT);
    expect((await vaultRepo.get())?.publicKeyHex).toBe(OLD_KEY.toPublicKey().toString());
    expect(await db.messages.count()).toBe(1);

    await switchAccount(luke.id);
    expect(await settingsRepo.getIdeasOnly()).toEqual(lukes);
    expect(await db.messages.count()).toBe(1);
  });

  it('is remembered across a relaunch, and says so to listeners', async () => {
    const luke = await twoAccounts();
    const heard = vi.fn();
    const off = onAccountChange(heard);
    await switchAccount(luke.id);
    off();
    expect(heard).toHaveBeenCalledTimes(1);

    // A relaunch: the in-memory state is gone; the store says which account was active.
    await resetAccounts({ keepStore: true });
    expect(activeBackendUrl()).toBe('/api');
    await loadAccounts();
    expect(getActiveAccount().id).toBe(luke.id);
    expect(activeBackendUrl()).toBe('https://luke.example/api');
  });

  it('refuses an account that does not exist, and stays where it was', async () => {
    await twoAccounts();
    await expect(switchAccount('nope')).rejects.toThrow(/no account/i);
    expect(getActiveAccount().id).toBe(FIRST_ACCOUNT_ID);
  });

  it('leaves the accounts store as the one place the accounts are kept', async () => {
    await twoAccounts();
    expect((await accountsRepo.list()).map((a) => a.name)).toHaveLength(2);
  });
});
