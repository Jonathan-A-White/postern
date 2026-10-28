// features/steps/accounts-screen.steps.tsx — runs features/accounts-screen.feature (mw-9rp4hu.5): the real Accounts
// section and the top bar's account name over the real accounts service, against a fake backend per address.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateKey, Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { AccountsSection } from '../../src/cockpit/AccountsSection';
import { AccountChip } from '../../src/cockpit/AccountChip';
import { accountDb, db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { getActiveAccount, loadAccounts, resetAccounts } from '../../src/services/accounts';
import { getKey, lock, setKey } from '../../src/services/keySession';
import { apiFetch } from '../../src/services/apiAuth';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

vi.mock('../../src/services/session', () => ({
  persistSession: vi.fn(async () => true),
  restoreSession: vi.fn(async () => null),
  clearSession: vi.fn(async () => undefined),
}));

const PHONE_KEY = PrivateKey.fromRandom();
const phoneMaster = new Uint8Array(Utils.toArray(PHONE_KEY.toHex(), 'hex'));
const PHONE_PUB = publicKeyHexFromMasterKey(phoneMaster);

let meCalls: { url: string; pub: string }[] = [];
let calls: string[] = [];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubBackends(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith('https://down.example')) throw new TypeError('Failed to fetch');
      if (isChallengeRequest(target)) return challengeResponse();
      if (target.endsWith('/me')) {
        const auth = new Headers(init?.headers).get('Authorization') ?? '';
        meCalls.push({ url: target, pub: auth.replace(/^Postern2 /, '').split(':')[0] });
        if (target.startsWith('https://nolicence.example')) return json({ reason: 'no_licence' }, 401);
        return json({ pubkey: PHONE_PUB, mayor: '', network: 'testnet', features: [] });
      }
      calls.push(target);
      return json({});
    }),
  );
}

async function open(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  meCalls = [];
  calls = [];
  lock();
  await resetAccounts();
  await Promise.all([db.settings.clear(), db.vault.clear()]);
  await loadAccounts();
  await vaultRepo.save({ mode: 'phrase', ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([2]), salt: new Uint8Array([3]), publicKeyHex: PHONE_PUB });
  setKey(phoneMaster);
  stubBackends();
  render(
    <>
      <AccountChip />
      <AccountsSection />
    </>,
  );
  await screen.findByRole('region', { name: 'Accounts' });
}

const section = () => within(screen.getByRole('region', { name: 'Accounts' }));

async function add(name: string, url: string, key: 'this' | 'new'): Promise<void> {
  await userEvent.click(section().getByRole('button', { name: 'Add account' }));
  await userEvent.type(section().getByLabelText('Backend address'), url);
  await userEvent.type(section().getByLabelText('Name'), name);
  await userEvent.click(section().getByLabelText(key === 'this' ? "This phone's key" : 'A new key'));
  await userEvent.click(section().getByRole('button', { name: 'Check and add' }));
}

async function listShows(...rows: string[]): Promise<void> {
  await waitFor(() => expect(section().getAllByRole('listitem').map((item) => item.getAttribute('data-account'))).toEqual(rows));
}

const activeMark = (name: string) => within(section().getByRole('listitem', { name })).queryByText('Active');

async function switchTo(name: string): Promise<void> {
  await userEvent.click(await waitFor(() => section().getByRole('button', { name: `Switch to ${name}` })));
}

const feature = await loadFeature('features/accounts-screen.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(open);

  Scenario("mw-9rp4hu.5 AC-1: an account is added with this phone's key, checked with its backend, and the app switches to it and back", ({ Given, When, Then, And }) => {
    Given('an unlocked phone with one account', () => {
      expect(getKey()).not.toBeNull();
    });
    When('he adds the account "Luke\'s factory" at "https://luke.example/api" with this phone\'s key', () => add("Luke's factory", 'https://luke.example/api', 'this'));
    Then("the backend was asked about this phone's key", async () => {
      await waitFor(() => expect(meCalls.at(-1)?.url).toBe('https://luke.example/api/me'));
      expect(meCalls.at(-1)?.pub).toBe(PHONE_KEY.toPublicKey().toString());
    });
    And('the Accounts list shows "Postern" as active and "Luke\'s factory"', async () => {
      await listShows('Postern', "Luke's factory");
      expect(activeMark('Postern')).not.toBeNull();
      expect(activeMark("Luke's factory")).toBeNull();
    });
    When('he switches to "Luke\'s factory"', () => switchTo("Luke's factory"));
    Then('"Luke\'s factory" is the active account and calls go to "https://luke.example/api"', async () => {
      await waitFor(() => expect(activeMark("Luke's factory")).not.toBeNull());
      await apiFetch('/ping', undefined, {});
      expect(calls.at(-1)).toBe('https://luke.example/api/ping');
      expect(getKey()).toEqual(phoneMaster); // the key chosen unlocked it
    });
    When('he switches to "Postern"', () => switchTo('Postern'));
    Then('"Postern" is the active account and calls go to "/api"', async () => {
      await waitFor(() => expect(activeMark('Postern')).not.toBeNull());
      await apiFetch('/ping', undefined, {});
      expect(calls.at(-1)).toBe('/api/ping');
    });
  });

  Scenario('mw-9rp4hu.5 AC-1: a backend that cannot be reached adds nothing', ({ Given, When, Then, And }) => {
    Given('an unlocked phone with one account', () => undefined);
    When('he adds the account "Down" at "https://down.example/api" with this phone\'s key', () => add('Down', 'https://down.example/api', 'this'));
    Then('the form says the key could not be checked with "https://down.example/api"', async () => {
      const alert = await waitFor(() => section().getByRole('alert'));
      expect(alert.textContent).toContain('Could not check the key with https://down.example/api');
    });
    And('the Accounts list shows only "Postern"', () => listShows('Postern'));
  });

  Scenario('mw-9rp4hu.5 AC-1: a backend that says the key holds no licence is added, with a line saying so', ({ Given, When, Then, And }) => {
    Given('an unlocked phone with one account', () => undefined);
    When('he adds the account "Unlicensed" at "https://nolicence.example/api" with this phone\'s key', () => add('Unlicensed', 'https://nolicence.example/api', 'this'));
    Then('the form says that backend holds no licence for the key', async () => {
      const status = await waitFor(() => section().getByRole('status'));
      expect(status.textContent).toMatch(/holds no licence/);
    });
    And('the Accounts list shows "Postern" as active and "Unlicensed"', () => listShows('Postern', 'Unlicensed'));
  });

  Scenario("mw-9rp4hu.5 AC-1: a new key is added unchecked, and its account opens at its own door", ({ Given, When, Then }) => {
    Given('an unlocked phone with one account', () => undefined);
    When('he adds the account "Fresh" at "https://fresh.example/api" with a new key', () => add('Fresh', 'https://fresh.example/api', 'new'));
    Then('the Accounts list shows "Postern" as active and "Fresh"', () => listShows('Postern', 'Fresh'));
    When('he switches to "Fresh"', () => switchTo('Fresh'));
    Then('"Fresh" is the active account with no key unlocked', async () => {
      await waitFor(() => expect(activeMark('Fresh')).not.toBeNull());
      expect(getKey()).toBeNull();
      expect(meCalls).toHaveLength(0); // nothing to check yet
    });
  });

  Scenario('mw-9rp4hu.5 AC-2: the top bar names no account when there is one, and names the active one when there are two', ({ Given, When, Then }) => {
    Given('an unlocked phone with one account', () => undefined);
    Then('the top bar names no account', () => {
      expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
    });
    When('he adds the account "Luke\'s factory" at "https://luke.example/api" with this phone\'s key', () => add("Luke's factory", 'https://luke.example/api', 'this'));
    Then('the top bar names "Postern"', async () => {
      expect((await screen.findByRole('button', { name: /^Account:/ })).textContent).toContain('Postern');
    });
    When('he taps the account name in the top bar and chooses "Luke\'s factory"', async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Account:/ }));
      await userEvent.click(within(screen.getByRole('menu', { name: 'Accounts' })).getByRole('menuitem', { name: "Luke's factory" }));
    });
    Then('the top bar names "Luke\'s factory"', async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: /^Account:/ }).textContent).toContain("Luke's factory"));
      expect(getActiveAccount().backendUrl).toBe('https://luke.example/api');
    });
  });

  Scenario('mw-9rp4hu.5 AC-1: an account is renamed, and removed only after a confirm, its key staying on the phone', ({ Given, When, Then, And }) => {
    let lukeId = '';
    Given('an unlocked phone with one account', () => undefined);
    When('he adds the account "Luke\'s factory" at "https://luke.example/api" with this phone\'s key', async () => {
      await add("Luke's factory", 'https://luke.example/api', 'this');
      await listShows('Postern', "Luke's factory");
      lukeId = section().getAllByRole('listitem')[1].getAttribute('data-id') ?? '';
    });
    And('he renames "Luke\'s factory" to "Luke"', async () => {
      await userEvent.click(section().getByRole('button', { name: "Rename Luke's factory" }));
      const field = section().getByLabelText('New name');
      await userEvent.clear(field);
      await userEvent.type(field, 'Luke');
      await userEvent.click(section().getByRole('button', { name: 'Save name' }));
    });
    Then('the Accounts list shows "Postern" as active and "Luke"', async () => {
      await listShows('Postern', 'Luke');
      expect(activeMark('Postern')).not.toBeNull();
    });
    When('he asks to remove "Luke" and keeps it', async () => {
      await userEvent.click(section().getByRole('button', { name: 'Remove Luke' }));
      await userEvent.click(section().getByRole('button', { name: 'Keep it' }));
    });
    Then('"Luke" is still on the Accounts list', () => listShows('Postern', 'Luke'));
    When('he asks to remove "Luke" and confirms', async () => {
      await userEvent.click(section().getByRole('button', { name: 'Remove Luke' }));
      await userEvent.click(section().getByRole('button', { name: 'Yes, remove Luke' }));
    });
    Then('the Accounts list shows only "Postern"', () => listShows('Postern'));
    And("the removed account's key is still in its store", async () => {
      expect((await accountDb(lukeId).vault.get('default'))?.publicKeyHex).toBe(PHONE_PUB);
    });
  });
});

afterAll(async () => {
  cleanup();
  vi.unstubAllGlobals();
  lock();
  await resetAccounts();
});
