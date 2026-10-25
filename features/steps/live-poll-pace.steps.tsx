// features/steps/live-poll-pace.steps.tsx — runs features/live-poll-pace.feature (mw-k3slte): the real live.ts loop and
// the real inbox sync on a fake clock, with only apiFetch a double. The finer lines of pace (a failing backend, a stream
// that cannot be opened) are in tests/unit/live-poll-pace.test.ts.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { startLive, stopLive } from '../../src/services/live';

const held = vi.hoisted(() => ({ features: [] as string[], streamCloses: false, messageCalls: [] as number[], eventCalls: [] as number[], hidden: false }));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/events')) {
      held.eventCalls.push(Date.now());
      return new Response(new ReadableStream({ start: (controller) => controller.close() }));
    }
    if (path.startsWith('/messages')) {
      held.messageCalls.push(Date.now());
      return new Response(JSON.stringify({ records: [], next: 0 }));
    }
    return new Response('{}');
  }),
}));
vi.mock('../../src/services/view', () => ({ refreshView: vi.fn(async () => 'absent') }));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: held.features })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const key = new Uint8Array(PrivateKey.fromHex('07'.repeat(32)).toArray());
Object.defineProperty(document, 'hidden', { configurable: true, get: () => held.hidden });

async function setUp(features: string[]): Promise<void> {
  held.features = features;
  held.messageCalls = [];
  held.eventCalls = [];
  held.hidden = false;
  vi.useRealTimers();
  stopLive();
  await db.settings.clear();
  await db.messages.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

afterAll(() => {
  held.hidden = false;
  stopLive();
  vi.useRealTimers();
});

const feature = await loadFeature('features/live-poll-pace.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a backend that answers is asked for the messages once a poll interval', ({ Given, When, Then }) => {
    Given('the backend has no event stream and answers every call', () => setUp([]));
    When('the app has been open for 5 minutes', async () => {
      startLive(key);
      for (let done = 0; done < 300_000; done += 1000) {
        await vi.advanceTimersByTimeAsync(1000);
        for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    Then('the messages were asked for at most once every 20 seconds', () => {
      expect(held.messageCalls.length).toBeGreaterThanOrEqual(10);
      expect(held.messageCalls.length).toBeLessThanOrEqual(1 + 300_000 / 20_000);
    });
  });

  Scenario('AC-2: a page nobody is looking at asks for nothing', ({ Given, And, When, Then }) => {
    Given('the backend has no event stream and answers every call', () => setUp([]));
    And('the page is hidden', () => {
      held.hidden = true;
    });
    When('the app has been open for 5 minutes', async () => {
      startLive(key);
      for (let done = 0; done < 300_000; done += 1000) {
        await vi.advanceTimersByTimeAsync(1000);
        for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    Then('the messages were asked for no more than at the start', () => {
      expect(held.messageCalls.length).toBeLessThanOrEqual(1);
    });
  });

  Scenario('AC-3: a stream that opens and closes at once is reconnected with a back-off', ({ Given, When, Then, And }) => {
    Given('the backend has an event stream that opens and closes at once', () => setUp(['events']));
    When('the app has been open for 5 minutes', async () => {
      startLive(key);
      for (let done = 0; done < 300_000; done += 1000) {
        await vi.advanceTimersByTimeAsync(1000);
        for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    Then('the stream was opened at most 16 times', () => {
      expect(held.eventCalls.length).toBeLessThanOrEqual(16);
    });
    And('the messages were asked for at most 17 times', () => {
      expect(held.messageCalls.length).toBeLessThanOrEqual(17);
    });
  });
});
