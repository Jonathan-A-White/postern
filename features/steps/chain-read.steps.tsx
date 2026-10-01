// features/steps/chain-read.steps.tsx — runs features/chain-read.feature (mw-a0ih0.5): the real
// live.ts loop, the real chain read and ring, the real Talk line and banner; only the backend
// (apiFetch, the syncs, /me), WhatsOnChain (a faked anchor chain) and the browser's notification
// and vibration are doubles, and the timers are fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { RingBanner } from '../../src/cockpit/RingBanner';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { db } from '../../src/data/db';
import { encodeCall } from '../../src/services/call';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { dismissIncomingRing } from '../../src/services/ringIn';
import { fakeAnchorChain, publicKeyOf, recordTransaction, type FakeAnchorChain } from '../../tests/support/chain-record';

configure({ asyncUtilTimeout: 5000 });

const net = vi.hoisted(() => ({ eventsUp: false, attempts: 0 }));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => {
    net.attempts += 1;
    if (!net.eventsUp) throw new Error('The network dropped.');
    return { ok: true, status: 200, body: new ReadableStream<Uint8Array>({ start() {} }) };
  }),
}));
vi.mock('../../src/services/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/inbox')>()),
  syncMessages: vi.fn(async () => {
    if (!net.eventsUp) throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    if (!net.eventsUp) throw new Error('The backend did not answer.');
    return 'unchanged';
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const PHONE_HEX = '07'.repeat(32);
const MAYOR_HEX = '77'.repeat(32);
const phoneKey = new Uint8Array(PrivateKey.fromHex(PHONE_HEX).toArray());
const REASON = 'Back now: two landings.';

let chain: FakeAnchorChain;
let ringTxid = '';
let showNotification: ReturnType<typeof vi.fn>;
let vibrate: ReturnType<typeof vi.fn>;
let callsBeforePoll = 0;

/** Lets the faked network, Dexie and the loop settle without moving the clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

async function setUp(): Promise<void> {
  cleanup();
  stopLive();
  dismissIncomingRing();
  vi.useRealTimers();
  await db.messages.clear();
  await db.settings.clear();
  window.history.replaceState(null, '', '/');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  net.eventsUp = false;
  net.attempts = 0;
  const at = Math.floor(Date.now() / 1000) - 5;
  const tx = recordTransaction({
    senderHex: MAYOR_HEX,
    recipientPublicKeyHex: publicKeyOf(PHONE_HEX),
    class: 'call',
    plaintext: encodeCall({ role: 'ring', text: REASON, at }),
    ts: at,
  });
  ringTxid = tx.txid;
  chain = fakeAnchorChain([tx]);
  vi.stubGlobal('fetch', chain.fetchImpl);
  showNotification = vi.fn(() => Promise.resolve());
  vibrate = vi.fn(() => true);
  vi.stubGlobal('Notification', { permission: 'granted' });
  Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve({ showNotification }) }, configurable: true });
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
}

/** From the first drop to just before the chain read: the loop keeps retrying the backend meanwhile. */
async function outOfReach(): Promise<void> {
  await act(async () => {
    startLive(phoneKey);
    await vi.advanceTimersByTimeAsync(0);
  });
  await flush();
  await advance(29_900);
  callsBeforePoll = net.attempts;
  await advance(200);
}

afterAll(() => {
  stopLive();
  dismissIncomingRing();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/chain-read.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario("AC-1: offline, a ring on chain rings and reopens the line", ({ Given, When, Then, And }) => {
    Given("the phone cannot reach the backend and the Mayor's ring is on chain", setUp);
    When('the phone has been out of reach for a while', outOfReach);
    Then("WhatsOnChain was asked for the anchor address's history", () => {
      expect(chain.calls.some((url) => url.endsWith('/confirmed/history'))).toBe(true);
      expect(chain.calls.some((url) => url.endsWith(`/tx/${ringTxid}/hex`))).toBe(true);
    });
    And("the phone rings with the Mayor's reason", () => {
      expect(getLiveState().status).not.toBe('live');
      expect(showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = showNotification.mock.calls[0] as [string, { body: string; data: { url: string } }];
      expect(title).toBe('The Mayor is calling');
      expect(options.body).toBe(REASON);
      expect(options.data.url).toBe(`/?v=line&call=${ringTxid}`);
    });
    And('the phone asks the backend again at once', () => {
      // The backoff had 1 s still to run; the ring cut it short.
      expect(net.attempts).toBeGreaterThan(callsBeforePoll);
    });
    And("the Talk line shows the Mayor's reason", async () => {
      vi.useRealTimers();
      window.history.replaceState(null, '', `/?v=line&call=${ringTxid}`);
      render(<TalkLineScreen />);
      await waitFor(() => expect(screen.getByTestId('ring-note')).toHaveTextContent(`The Mayor called`));
      expect(screen.getByTestId('ring-note')).toHaveTextContent(REASON);
      stopLive();
    });
  });

  Scenario('AC-2: offline with notifications off, a ring on chain raises a banner and vibrates', ({ Given, When, Then, And }) => {
    Given("the phone cannot reach the backend and the Mayor's ring is on chain", setUp);
    And('notifications are not allowed', () => {
      vi.stubGlobal('Notification', { permission: 'denied' });
    });
    When('the phone has been out of reach for a while', outOfReach);
    Then('the banner says the Mayor is calling, with the reason', async () => {
      vi.useRealTimers();
      render(<RingBanner />);
      expect(screen.getByRole('alert')).toHaveTextContent('The Mayor is calling');
      expect(screen.getByRole('alert')).toHaveTextContent(REASON);
      expect(showNotification).not.toHaveBeenCalled();
    });
    And('the phone vibrates', () => {
      expect(vibrate).toHaveBeenCalled();
    });
    When('he taps Answer on the banner', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    });
    Then('the Talk line is open on that ring', () => {
      expect(window.location.search).toBe(`?v=line&call=${ringTxid}`);
      expect(screen.queryByRole('alert')).toBeNull();
      stopLive();
    });
  });

  Scenario('AC-3: chain polling stops once the event stream is back', ({ Given, When, Then, And }) => {
    Given("the phone cannot reach the backend and the Mayor's ring is on chain", setUp);
    When('the phone has been out of reach for a while', outOfReach);
    And('the event stream comes back', async () => {
      net.eventsUp = true;
      // The ring above cut the backoff short; the next attempt is within seconds of backoff.
      await advance(40_000);
    });
    Then('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
    And('WhatsOnChain is not asked again', async () => {
      const before = chain.calls.length;
      await advance(120_000);
      expect(chain.calls.length).toBe(before);
      stopLive();
    });
  });
});
