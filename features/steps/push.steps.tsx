// features/steps/push.steps.tsx — runs features/push.feature under vitest via
// @amiceli/vitest-cucumber. AC-1..4 exercise src/push/classOptions.ts directly
// (the same pure function src/sw.ts's push handler calls); AC-5/AC-6 exercise
// src/services/push.ts with Notification, navigator.serviceWorker, and fetch
// stubbed, since jsdom implements none of the Push API.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, PublicKey, Signature, Utils } from '@bsv/sdk';
import { notificationSpecForClass } from '../../src/push/classOptions';
import type { NotificationSpec } from '../../src/push/classOptions';
import { subscribeToPush } from '../../src/services/push';
import type { MessageClass } from '../../src/data/db';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const PUBLIC_KEY_HEX = 'aa'.repeat(33);
const FAKE_SUBSCRIPTION_JSON = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
const UNLOCKED_KEY = PrivateKey.fromRandom();
const UNLOCKED_MASTER_KEY = new Uint8Array(Utils.toArray(UNLOCKED_KEY.toHex(), 'hex'));

function installNotificationMock(permission: NotificationPermission): void {
  Object.defineProperty(window, 'Notification', {
    value: { requestPermission: vi.fn(async () => permission) },
    configurable: true,
    writable: true,
  });
}

function installServiceWorkerMock(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: { subscribe: vi.fn(async () => ({ toJSON: () => FAKE_SUBSCRIPTION_JSON })) },
      }),
    },
    configurable: true,
    writable: true,
  });
}

let vapidKeyFetched: boolean;
let subscribeBody: unknown;
let authHeaders: string[];

function installFetchMock(options: { unauthorized?: boolean } = {}) {
  vapidKeyFetched = false;
  subscribeBody = null;
  authHeaders = [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth) authHeaders.push(auth);
    if (options.unauthorized) return new Response(JSON.stringify({ error: 'no licence held' }), { status: 401 });
    if (url.endsWith('/push/vapid-public-key')) {
      vapidKeyFetched = true;
      return new Response(JSON.stringify({ publicKey: 'server-vapid-public-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/push/subscribe')) {
      subscribeBody = JSON.parse(String(init?.body));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const feature = await loadFeature('features/push.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: decision-needed vibrates and stays until dismissed', ({ Given, Then }) => {
    let spec: NotificationSpec;

    Given('a pushed record of class "decision-needed"', () => {
      spec = notificationSpecForClass('decision-needed' as MessageClass, 'tx1');
    });

    Then('the notification vibrates and requires interaction to dismiss', () => {
      expect(spec.options.vibrate).toBeDefined();
      expect(spec.options.requireInteraction).toBe(true);
    });
  });

  Scenario("AC-2: landing is a normal alert whose repeats replace each other", ({ Given, Then }) => {
    let spec: NotificationSpec;

    Given('a pushed record of class "landing"', () => {
      spec = notificationSpecForClass('landing' as MessageClass, 'tx1');
    });

    Then('the notification is tagged "landing" so a repeat replaces it', () => {
      expect(spec.options.tag).toBe('landing');
      expect(spec.options.renotify).toBeFalsy();
    });
  });

  Scenario('AC-3: alarm is loud, insistent, and re-alerts on repeat', ({ Given, Then }) => {
    let spec: NotificationSpec;

    Given('a pushed record of class "alarm"', () => {
      spec = notificationSpecForClass('alarm' as MessageClass, 'tx1');
    });

    Then('the notification vibrates, requires interaction, and renotifies on repeat', () => {
      expect(spec.options.vibrate).toBeDefined();
      expect(spec.options.requireInteraction).toBe(true);
      expect(spec.options.renotify).toBe(true);
    });
  });

  Scenario('AC-4: message is a quiet, watch-friendly buzz', ({ Given, Then }) => {
    let spec: NotificationSpec;

    Given('a pushed record of class "message"', () => {
      spec = notificationSpecForClass('message' as MessageClass, 'tx1');
    });

    Then('the notification is a soft buzz that does not require interaction', () => {
      expect(spec.options.vibrate).toBeDefined();
      expect(spec.options.requireInteraction).toBeFalsy();
    });
  });

  Scenario('AC-5: subscribing posts the subscription', ({ Given, When, Then, And }) => {
    let thrown: Error | null;

    Given('notification permission will be granted', () => {
      installNotificationMock('granted');
      installServiceWorkerMock();
      vi.stubGlobal('fetch', installFetchMock());
    });

    When('this phone subscribes to push', async () => {
      thrown = null;
      try {
        await subscribeToPush({ publicKeyHex: PUBLIC_KEY_HEX });
      } catch (err) {
        thrown = err as Error;
      }
    });

    Then("the backend's VAPID key is fetched", () => {
      expect(thrown).toBeNull();
      expect(vapidKeyFetched).toBe(true);
    });

    And("the subscription is posted with this phone's public key", () => {
      expect(subscribeBody).toEqual({ pubkey: PUBLIC_KEY_HEX, subscription: FAKE_SUBSCRIPTION_JSON });
    });
  });

  Scenario('AC-6: a denied permission does not subscribe', ({ Given, When, Then }) => {
    let thrown: Error | null;

    Given('notification permission will be denied', () => {
      installNotificationMock('denied');
      installServiceWorkerMock();
      vi.stubGlobal('fetch', installFetchMock());
    });

    When('this phone subscribes to push', async () => {
      thrown = null;
      try {
        await subscribeToPush({ publicKeyHex: PUBLIC_KEY_HEX });
      } catch (err) {
        thrown = err as Error;
      }
    });

    Then('no subscription is posted', () => {
      expect(thrown).not.toBeNull();
      expect(subscribeBody).toBeNull();
    });
  });

  Scenario('mw-f758y.22.2 AC1: subscribing with an unlocked key signs the challenge on every call', ({ Given, When, Then }) => {
    Given('notification permission will be granted and a key is unlocked', () => {
      installNotificationMock('granted');
      installServiceWorkerMock();
      vi.stubGlobal('fetch', installFetchMock());
    });

    When('this phone subscribes to push', async () => {
      await subscribeToPush({ publicKeyHex: PUBLIC_KEY_HEX, unlockedKey: UNLOCKED_MASTER_KEY });
    });

    Then('both calls carried a signed proof of the unlocked key', () => {
      expect(authHeaders).toHaveLength(2);
      for (const header of authHeaders) {
        const match = header.match(/^Postern ([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
        expect(match).not.toBeNull();
        const [, pubkeyHex, nonceHex, sigHex] = match!;
        expect(pubkeyHex).toBe(UNLOCKED_KEY.toPublicKey().toString());
        expect(PublicKey.fromString(pubkeyHex).verify(nonceHex, Signature.fromDER(sigHex, 'hex'))).toBe(true);
      }
    });
  });

  Scenario('mw-f758y.22.2 AC2: a 401 while subscribing shows "Licence required"', ({ Given, And, When, Then }) => {
    let thrown: Error | null;

    Given('notification permission will be granted and a key is unlocked', () => {
      installNotificationMock('granted');
      installServiceWorkerMock();
    });

    And('the backend answers every proved call with 401', () => {
      vi.stubGlobal('fetch', installFetchMock({ unauthorized: true }));
    });

    When('this phone subscribes to push', async () => {
      thrown = null;
      try {
        await subscribeToPush({ publicKeyHex: PUBLIC_KEY_HEX, unlockedKey: UNLOCKED_MASTER_KEY });
      } catch (err) {
        thrown = err as Error;
      }
    });

    Then('subscribing fails with "Licence required"', () => {
      expect(thrown?.message).toBe('Licence required');
    });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});
