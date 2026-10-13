// features/steps/view-fetch-economy.steps.tsx — runs features/view-fetch-economy.feature
// (mw-7dige5.1): the real live.ts loop reading a stream this file writes to; the message sync
// (with its events projection), the view fetch and /me are doubles, and the clock is fake.
// The sync double does what the real one does with a gap or a batch it cannot apply: it
// reports the view fetched, and counts that fetch.
import { act } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { startLive, stopLive } from '../../src/services/live';

const net = vi.hoisted(() => ({
  stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  /** what the next message sync reports: events applied, and the view fetched because of a gap or a batch it could not apply */
  next: { applied: 0, refetched: false },
  viewFetches: 0,
  /** whether the view fetch at the start fails (the phone has no signal) */
  viewDown: false,
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
    const { applied, refetched } = net.next;
    net.next = { applied: 0, refetched: false };
    if (refetched) net.viewFetches += 1;
    return { applied, refetched };
  }),
  projectBatches: vi.fn(async () => ({ applied: [], refetch: false, details: [] })),
}));
vi.mock('../../src/services/view', () => ({
  // Like the real one, a fetched view is kept under the ETag the backend gave it.
  refreshView: vi.fn(async () => {
    if (net.viewDown) throw new Error('No signal.');
    net.viewFetches += 1;
    await viewRepo.save({ plaintext: '{}', written_at: 'w', etag: '"v1"', source: 'live', fetchedAt: 0 });
    return 'updated';
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

async function start(): Promise<void> {
  stopLive();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  net.stream = undefined;
  net.next = { applied: 0, refetched: false };
  net.viewFetches = 0;
  await db.view.clear();
  await act(async () => {
    startLive(new Uint8Array(32).fill(9));
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function liveWithEvents(): Promise<void> {
  net.viewDown = false;
  await start();
  await say('event: hello\ndata: {"head": 1, "view": "\\"v1\\""}');
  net.next = { applied: 1, refetched: false };
  await say('event: message\ndata: {"seq": 1}');
  await advance(60_000);
}

/** The stream drops, the loop waits its second, syncs, and opens a new stream, which greets with hello naming the view the phone holds. */
async function dropAndReturn(): Promise<void> {
  net.stream?.close();
  await advance(1_000);
  await advance(0);
  await say('event: hello\ndata: {"head": 2, "view": "\\"v1\\""}');
  await advance(1_000);
}

afterAll(() => {
  stopLive();
  vi.useRealTimers();
});

const feature = await loadFeature('features/view-fetch-economy.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-7dige5.1: a busy hour fetches the view once, at the start', ({ Given, When, Then }) => {
    Given('the event stream is live, the view fetched at the start and events flowing', liveWithEvents);
    When('an hour passes with a view event every 30 seconds, each followed by its events batch', async () => {
      for (let i = 0; i < 120; i += 1) {
        await say('event: view\ndata: {"etag": "\\"v\\""}');
        await advance(2_000);
        net.next = { applied: 1, refetched: false };
        await say('event: message\ndata: {"seq": 2}');
        await advance(28_000);
      }
    });
    Then('the view was fetched once in all', () => {
      expect(net.viewFetches).toBe(1);
    });
  });

  Scenario('mw-7dige5.1: a reconnect whose first batch follows on fetches nothing', ({ Given, When, Then }) => {
    Given('the event stream is live, the view fetched at the start and events flowing', liveWithEvents);
    When('the stream drops and comes back, and the first batch follows on from the last seq seen', dropAndReturn);
    Then('the view was fetched once in all', () => {
      expect(net.viewFetches).toBe(1);
    });
  });

  Scenario('mw-7dige5.1: a reconnect with a gap in the seqs fetches the view once', ({ Given, When, Then }) => {
    Given('the event stream is live, the view fetched at the start and events flowing', liveWithEvents);
    When('the stream drops and comes back, and the first batch skips seqs', async () => {
      net.next = { applied: 1, refetched: true };
      await dropAndReturn();
    });
    Then('the view was fetched twice in all', () => {
      expect(net.viewFetches).toBe(2);
    });
  });

  Scenario('mw-7dige5.1: a batch that cannot be applied fetches the view once', ({ Given, When, Then }) => {
    Given('the event stream is live, the view fetched at the start and events flowing', liveWithEvents);
    When('a batch comes that cannot be applied', async () => {
      net.next = { applied: 1, refetched: true };
      await say('event: message\ndata: {"seq": 2}');
    });
    Then('the view was fetched twice in all', () => {
      expect(net.viewFetches).toBe(2);
    });
  });

  Scenario('mw-7dige5.1: a reconnect after a start that could not reach the view fetches it', ({ Given, When, Then }) => {
    Given('the event stream is live and the view could not be fetched at the start', async () => {
      net.viewDown = true;
      await start();
      net.viewDown = false;
    });
    When('the stream drops and comes back, and the first batch follows on from the last seq seen', dropAndReturn);
    Then('the view was fetched once after the start', () => {
      expect(net.viewFetches).toBe(1);
    });
  });
});
