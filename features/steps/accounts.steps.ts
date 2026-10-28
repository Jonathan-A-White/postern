// features/steps/accounts.steps.ts — runs features/accounts.feature (mw-9rp4hu.4): the accounts model and the
// plumbing behind it (the API client, the unlocked key, the licence, the stores), with no screen.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db, FIRST_ACCOUNT_ID } from '../../src/data/db';
import { settingsRepo, vaultRepo } from '../../src/data/repositories';
import { addAccount, getActiveAccount, listAccounts, loadAccounts, resetAccounts, switchAccount, type Account } from '../../src/services/accounts';
import { apiFetch } from '../../src/services/apiAuth';
import { getKey, lock, setKey } from '../../src/services/keySession';
import { getCachedLicenceStatus, type LicenceStatus } from '../../src/services/licence';

vi.mock('../../src/services/session', () => ({
  persistSession: vi.fn(async () => true),
  restoreSession: vi.fn(async () => null),
  clearSession: vi.fn(async () => undefined),
}));

const OLD_KEY = PrivateKey.fromRandom();
const LUKE_KEY = PrivateKey.fromRandom();
const NONCE = 'e'.repeat(64);
const LICENCE: LicenceStatus = { held: true, outpoint: { txid: 'f'.repeat(64), vout: 0 }, collection: 'postern', checkedAt: '2026-10-01T00:00:00.000Z' };
const LUKES_BACKEND = 'https://luke.example/api';
const master = (key: PrivateKey): Uint8Array => new Uint8Array(Utils.toArray(key.toHex(), 'hex'));
const MESSAGE_ID = 'a'.repeat(64) + ':0';

let calls: { url: string; auth: string | null }[] = [];
let luke: Account;

const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url.endsWith('/challenge')) return new Response(JSON.stringify({ nonce: NONCE }), { status: 200 });
  calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
  return new Response('{}', { status: 200 });
};

async function callBackend(): Promise<void> {
  await apiFetch('/me', undefined, { unlockedKey: getKey() ?? undefined, fetchImpl });
}

const feature = await loadFeature('features/accounts.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    calls = [];
    lock();
    await resetAccounts();
    await Promise.all([db.settings.clear(), db.vault.clear(), db.messages.clear()]);
  });

  Scenario("mw-9rp4hu.4 AC-1: yesterday's single account becomes account 1, active, with the same key and licence", ({ Given, When, Then, And }) => {
    Given('a phone that kept one key, one licence and some messages before accounts existed', async () => {
      await vaultRepo.save({ mode: 'phrase', ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([2]), publicKeyHex: OLD_KEY.toPublicKey().toString() });
      await db.settings.put({ key: 'licence-status', value: LICENCE });
      await db.messages.put({ id: MESSAGE_ID, txid: 'a'.repeat(64), vout: 0, seq: 1, class: 'message', to: 'x', from: 'y', ts: 1, ciphertext: 'ab', direction: 'received', read: false });
    });
    When('the app opens', async () => {
      await loadAccounts();
    });
    Then('there is one account and it is the active one', async () => {
      const accounts = await listAccounts();
      expect(accounts).toHaveLength(1);
      expect(getActiveAccount().id).toBe(accounts[0].id);
      expect(accounts[0].id).toBe(FIRST_ACCOUNT_ID);
    });
    And('it has the same key and the same licence', async () => {
      expect((await vaultRepo.get())?.publicKeyHex).toBe(OLD_KEY.toPublicKey().toString());
      expect(await getCachedLicenceStatus()).toEqual(LICENCE);
      expect(await settingsRepo.get('licence-status')).toBeUndefined(); // moved onto the account, not copied
    });
    And('the messages are still there', async () => {
      expect(await db.messages.get(MESSAGE_ID)).toBeDefined();
    });
  });

  Scenario("mw-9rp4hu.4 AC-1: switching the active account switches the backend and the key the client signs with", ({ Given, When, Then }) => {
    Given('a phone with account 1 and a second account on another backend', async () => {
      await loadAccounts();
      setKey(master(OLD_KEY));
      luke = await addAccount({ name: "Luke's factory", backendUrl: LUKES_BACKEND });
    });
    When("he switches to the second account and unlocks its key", async () => {
      await switchAccount(luke.id);
      setKey(master(LUKE_KEY));
    });
    Then("a call goes to the second account's backend, signed with its key", async () => {
      await callBackend();
      expect(calls.at(-1)?.url).toBe(`${LUKES_BACKEND}/me`);
      expect(calls.at(-1)?.auth).toMatch(new RegExp(`^Postern2 ${LUKE_KEY.toPublicKey().toString()}:`));
    });
    When('he switches back to the first account', async () => {
      await switchAccount(FIRST_ACCOUNT_ID);
    });
    Then("a call goes to the first account's backend, signed with its key", async () => {
      await callBackend();
      expect(calls.at(-1)?.url).toBe('/api/me');
      expect(calls.at(-1)?.auth).toMatch(new RegExp(`^Postern2 ${OLD_KEY.toPublicKey().toString()}:`));
    });
  });
});

afterAll(async () => {
  lock();
  await resetAccounts();
});
