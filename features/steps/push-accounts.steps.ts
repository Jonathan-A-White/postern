// features/steps/push-accounts.steps.ts — runs features/push-accounts.feature (mw-9rp4hu.23): pushes per account.
// The real src/sw.ts (tests/support/sw-harness.ts) runs once per account registration, and src/services/push.ts
// subscribes and unsubscribes against fake registrations (tests/support/push-registrations.ts).
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { accountDb, db } from '../../src/data/db';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../src/push/classOptions';
import { addAccount, removeAccount, resetAccounts } from '../../src/services/accounts';
import { subscribeToPush } from '../../src/services/push';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { installPushRegistrations, type FakeRegistration } from '../../tests/support/push-registrations';
import { fakeWindowClient, loadWorker, type WorkerHarness } from '../../tests/support/sw-harness';

const TXID = `direct:${'ab'.repeat(32)}`;
const LUKE = 'https://luke.example/api';
const KEY = PrivateKey.fromRandom();
const MASTER = new Uint8Array(Utils.toArray(KEY.toHex(), 'hex'));
const PUBKEY = KEY.toPublicKey().toString();

async function keepMessageSwitches(accountId: string, quiet: boolean) {
  await accountDb(accountId).settings.put({
    key: 'notificationSettings',
    value: { message: { ...DEFAULT_NOTIFICATION_SETTINGS.message, quiet, sound: !quiet, vibrate: !quiet } },
  });
}

let first: WorkerHarness;
let second: WorkerHarness;
let registrations: FakeRegistration[];
let calls: string[];

function installBackends() {
  calls = [];
  ({ registrations } = installPushRegistrations());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      calls.push(url);
      if (url.endsWith('/push/vapid-public-key')) return new Response(JSON.stringify({ publicKey: 'server-vapid-public-key' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
}

const feature = await loadFeature('features/push-accounts.feature');

describeFeature(feature, ({ BeforeEachScenario, Scenario }) => {
  BeforeEachScenario(async () => {
    await resetAccounts();
    for (const id of ['1', '2']) await accountDb(id).settings.clear();
    await db.settings.clear();
  });

  Scenario('mw-9rp4hu.23 AC1: a push is shown from the database of the account it is for, whichever account is open', ({ Given, When, Then, And }) => {
    let app: ReturnType<typeof fakeWindowClient>;
    Given('two accounts that keep different notification switches for a message', async () => {
      await keepMessageSwitches('1', false);
      await keepMessageSwitches('2', true);
    });
    When("a message is pushed to the second account's registration, then to the first's", async () => {
      // The window is open on the app but not on screen, so the worker does not ask it about the message.
      second = await loadWorker({ account: '2' });
      app = fakeWindowClient();
      app.visibilityState = 'hidden';
      second.openWindows.push(app);
      await second.push({ class: 'message', txid: TXID, ts: 1_790_000_000 });
      await second.click(second.open[0]);
      // Both workers share the one `self` of the test page, so the first is loaded after the second is done with.
      first = await loadWorker();
      await first.push({ class: 'message', txid: TXID, ts: 1_790_000_000 });
    });
    Then("the second account's notification is silent and the first account's sounds", () => {
      expect(second.shown[0].options).toMatchObject({ silent: true });
      expect(first.shown[0].options).toMatchObject({ silent: false });
    });
    And("a tap on the second account's notification told the window to switch to the second account", () => {
      expect(app.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'open', account: '2' }));
    });
  });

  Scenario('mw-9rp4hu.23 AC1: with one account a push behaves as it did', ({ Given, When, Then }) => {
    Given('one account that keeps the default notification switches', () => undefined);
    When("a message is pushed to the app's own registration", async () => {
      first = await loadWorker();
      await first.push({ class: 'message', txid: TXID, ts: 1_790_000_000 });
    });
    Then('the notification sounds and nothing in it names an account other than the first', () => {
      expect(first.shown).toHaveLength(1);
      expect(first.shown[0].options).toMatchObject({ silent: false });
      expect(JSON.stringify(first.shown[0].options.data)).not.toContain('"account"');
    });
  });

  Scenario('mw-9rp4hu.23 AC2: each account subscribes with its own backend', ({ Given, When, Then }) => {
    Given('a second account on another backend', async () => {
      installBackends();
      await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    });
    When('both accounts turn notifications on', async () => {
      await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '1' });
      await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '2' });
    });
    Then('each backend was asked for its own key and given its own subscription, from its own registration', () => {
      expect(calls).toEqual(['/api/push/vapid-public-key', '/api/push/subscribe', `${LUKE}/push/vapid-public-key`, `${LUKE}/push/subscribe`]);
      expect(registrations).toHaveLength(2);
      expect(registrations[0].subscription?.endpoint).not.toBe(registrations[1].subscription?.endpoint);
    });
  });

  Scenario('mw-9rp4hu.23 AC2: removing an account unsubscribes it', ({ Given, When, Then }) => {
    let lukes: FakeRegistration;
    let subscription: NonNullable<FakeRegistration['subscription']>;
    Given('a second account on another backend that has notifications on', async () => {
      installBackends();
      await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
      await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '1' });
      await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '2' });
      lukes = registrations[1];
      subscription = lukes.subscription!;
    });
    When('the second account is removed', async () => {
      await removeAccount('2');
      await vi.waitFor(() => expect(lukes.unregister).toHaveBeenCalled());
    });
    Then("its subscription is cancelled and its registration dropped, and the first account's push stays on", () => {
      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
      expect(registrations).toHaveLength(1);
      expect(registrations[0].subscription).not.toBeNull();
    });
  });
});
