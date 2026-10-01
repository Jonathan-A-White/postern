// features/steps/events-view-recovery.steps.tsx — runs features/events-view-recovery.feature
// (mw-jrx0s.7): the real live.ts loop reading a stream this file writes to; the message sync
// (with its events projection), the view fetch and /me are doubles, and the clock is fake.
import { act } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { startLive, stopLive } from '../../src/services/live';

const net = vi.hoisted(() => ({
  stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  /** whether the next message sync applies an events batch */
  batch: false,
  viewFetches: 0,
}));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        net.stream = controller;
      },
    }),
  })),
}));
vi.mock('../../src/services/events', () => ({
  syncMessagesAndEvents: vi.fn(async () => {
    const applied = net.batch ? 1 : 0;
    net.batch = false;
    return { applied, refetched: false };
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    net.viewFetches += 1;
    return 'unchanged';
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events', 'view'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

const encoder = new TextEncoder();

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function say(block: string): Promise<void> {
  net.stream?.enqueue(encoder.encode(`${block}\n\n`));
  await advance(0);
}

async function live(): Promise<void> {
  stopLive();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  net.stream = undefined;
  net.batch = false;
  await act(async () => {
    startLive(new Uint8Array(32).fill(9));
    await vi.advanceTimersByTimeAsync(0);
  });
  net.viewFetches = 0;
}

async function liveWithEvents(): Promise<void> {
  await live();
  net.batch = true;
  await say('event: message\ndata: {"seq": 1}');
  await advance(60_000);
  net.viewFetches = 0;
}

afterAll(() => {
  stopLive();
  vi.useRealTimers();
});

const feature = await loadFeature('features/events-view-recovery.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-jrx0s.7: before any events batch, a view event fetches the view at once', ({ Given, When, Then }) => {
    Given('the event stream is live and no events batch has come this session', live);
    When('the stream says the view changed', async () => {
      await say('event: view\ndata: {"etag": "\\"v2\\""}');
    });
    Then('the view is fetched at once', () => {
      expect(net.viewFetches).toBe(1);
    });
  });

  Scenario('mw-jrx0s.7: once events flow, a view event that a batch follows fetches nothing', ({ Given, When, Then }) => {
    Given('the event stream is live and an events batch was applied a minute ago', liveWithEvents);
    When('the stream says the view changed and a batch follows it', async () => {
      await say('event: view\ndata: {"etag": "\\"v2\\""}');
      await advance(2_000);
      net.batch = true;
      await say('event: message\ndata: {"seq": 2}');
    });
    Then('ten seconds on, the view has not been fetched', async () => {
      await advance(10_000);
      expect(net.viewFetches).toBe(0);
    });
  });

  Scenario('mw-jrx0s.7: once events flow, a view event that no batch follows fetches the view', ({ Given, When, Then }) => {
    Given('the event stream is live and an events batch was applied a minute ago', liveWithEvents);
    When('the stream says the view changed and nothing follows it', async () => {
      await say('event: view\ndata: {"etag": "\\"v2\\""}');
    });
    Then('ten seconds on, the view has been fetched once', async () => {
      await advance(10_000);
      expect(net.viewFetches).toBe(1);
    });
  });
});
