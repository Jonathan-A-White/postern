// mw-9rp4hu.23: each account's push subscription is registered with its own backend, through a push-only service
// worker registration of its own (a registration holds one subscription, made with one backend's VAPID key), and
// removing the account takes the subscription down again.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { addAccount, getActiveAccount, landOnAccount, removeAccount, resetAccounts, switchAccount } from '../../src/services/accounts';
import { isPushSubscribed, subscribeToPush } from '../../src/services/push';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';
import { installPushRegistrations, type FakeRegistration } from '../support/push-registrations';

const KEY = PrivateKey.fromRandom();
const MASTER = new Uint8Array(Utils.toArray(KEY.toHex(), 'hex'));
const PUBKEY = KEY.toPublicKey().toString();
const LUKE = 'https://luke.example/api';

let registrations: FakeRegistration[];
let register: ReturnType<typeof vi.fn>;
let calls: Array<{ url: string; body?: unknown }>;

beforeEach(async () => {
  await resetAccounts();
  await db.settings.clear();
  calls = [];
  ({ registrations, register } = installPushRegistrations());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/push/vapid-public-key')) return new Response(JSON.stringify({ publicKey: 'server-vapid-public-key' }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

describe("an account's push subscription", () => {
  it("is made with the account's own backend, on a registration of its own", async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '2' });

    expect(calls.map((call) => call.url)).toEqual([`${LUKE}/push/vapid-public-key`, `${LUKE}/push/subscribe`]);
    expect(register).toHaveBeenCalledWith('https://postern.allmymind.org/sw.js', { scope: '/push-account/2/' });
    const [main, lukes] = registrations;
    expect(main.pushManager.subscribe).not.toHaveBeenCalled();
    expect(lukes.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(calls[1].body).toMatchObject({ pubkey: PUBKEY, subscription: { endpoint: 'https://push.example//push-account/2/' } });
  });

  it("account 1's stays on the app's own registration, with the first backend, as before", async () => {
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER });
    expect(register).not.toHaveBeenCalled();
    expect(registrations[0].pushManager.subscribe).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.url)).toEqual(['/api/push/vapid-public-key', '/api/push/subscribe']);
  });

  it('is the active account\'s when none is named, whichever it is', async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await switchAccount('2');
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER });
    expect(calls[1].url).toBe(`${LUKE}/push/subscribe`);
    expect(register).toHaveBeenCalledWith(expect.any(String), { scope: '/push-account/2/' });
  });

  it("is read per account: account 2 is subscribed only when its own registration holds one", async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER });
    expect(await isPushSubscribed('1')).toBe(true);
    expect(await isPushSubscribed('2')).toBe(false);
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '2' });
    expect(await isPushSubscribed('2')).toBe(true);
  });

  it('is unsubscribed, and its registration dropped, when the account is removed; the others keep theirs', async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER });
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER, accountId: '2' });
    const lukes = registrations[1];
    const subscription = lukes.subscription!;

    await removeAccount('2');
    await vi.waitFor(() => expect(lukes.unregister).toHaveBeenCalled());

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(registrations.map((registration) => registration.scope)).toEqual(['https://postern.allmymind.org/']);
    expect(registrations[0].subscription).not.toBeNull();
  });

  it("removing account 1 (another remains) unsubscribes the app's own registration but keeps the registration", async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await subscribeToPush({ publicKeyHex: PUBKEY, unlockedKey: MASTER });
    const main = registrations[0];
    const subscription = main.subscription!;
    await removeAccount('1');
    await vi.waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
    expect(main.unregister).not.toHaveBeenCalled();
  });

  it('a removal with nothing subscribed does nothing and throws nothing', async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await expect(removeAccount('2')).resolves.toBeUndefined();
  });

  it("a tap on account 2's notification lands in account 2, and on a gone account leaves the app where it is", async () => {
    await addAccount({ id: '2', name: 'Luke', backendUrl: LUKE });
    await landOnAccount('1');
    expect(getActiveAccount().id).toBe('1');
    await landOnAccount('2');
    expect(getActiveAccount().id).toBe('2');
    await landOnAccount('gone');
    expect(getActiveAccount().id).toBe('2');
  });
});
