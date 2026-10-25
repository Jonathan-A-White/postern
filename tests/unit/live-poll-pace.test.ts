// tests/unit/live-poll-pace.test.ts — how fast the app's own live loop (src/services/live.ts) asks GET /api/messages
// (mw-k3slte): on a fake clock, with the real loop and the real inbox sync, and only apiFetch a double. Four lines of
// pace: a backend that answers is asked once an interval (POLL_MS, 20 s), one that fails is asked no faster, a page nobody
// is looking at asks nothing, and a stream that drops or closes at once is reconnected with a back-off, not in a tight loop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { startLive, stopLive } from '../../src/services/live';

type Mode = 'answers' | 'fails';
let mode: Mode = 'answers';
let features: string[] = [];
let streamEnds = false;
let messageCalls: number[] = [];
let eventCalls: number[] = [];

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/events')) {
      eventCalls.push(Date.now());
      if (!streamEnds) throw new Error('The network dropped.');
      return new Response(new ReadableStream({ start: (controller) => controller.close() }));
    }
    if (path.startsWith('/messages')) {
      messageCalls.push(Date.now());
      if (mode === 'fails') return new Response('no', { status: 500 });
      return new Response(JSON.stringify({ records: [], next: 0 }));
    }
    return new Response('{}');
  }),
}));
vi.mock('../../src/services/view', () => ({ refreshView: vi.fn(async () => 'absent') }));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const key = new Uint8Array(PrivateKey.fromHex('07'.repeat(32)).toArray());
let hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

const FIVE_MINUTES = 300_000;
const POLL_MS = 20_000;

/** Moves the fake clock, letting Dexie's promises settle between the steps. */
async function run(ms: number): Promise<void> {
  for (let done = 0; done < ms; done += 1000) {
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function open(): Promise<void> {
  startLive(key);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  mode = 'answers';
  features = [];
  streamEnds = false;
  hidden = false;
  messageCalls = [];
  eventCalls = [];
  vi.useRealTimers();
  stopLive();
  await db.settings.clear();
  await db.messages.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  hidden = false;
  stopLive();
  vi.useRealTimers();
});

describe('the live loop asks GET /api/messages gently (mw-k3slte)', () => {
  it('a backend without the stream is asked once a poll interval while it answers', async () => {
    await open();
    await run(FIVE_MINUTES);
    // the start, then one a poll interval
    expect(messageCalls.length).toBeGreaterThanOrEqual(10);
    expect(messageCalls.length).toBeLessThanOrEqual(1 + FIVE_MINUTES / POLL_MS);
    const gaps = messageCalls.slice(1).map((at, i) => at - messageCalls[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(POLL_MS - 1000);
  });

  it('a backend that fails every answer is asked no faster than one that answers', async () => {
    mode = 'fails';
    await open();
    await run(FIVE_MINUTES);
    expect(messageCalls.length).toBeGreaterThan(1);
    expect(messageCalls.length).toBeLessThanOrEqual(1 + FIVE_MINUTES / POLL_MS);
  });

  it('a page nobody is looking at asks nothing', async () => {
    await open();
    await run(1000);
    hidden = true;
    const before = messageCalls.length;
    await run(FIVE_MINUTES);
    expect(messageCalls.length).toBe(before);
  });

  it('a stream that cannot be opened is retried with a back-off, so the messages are asked a few times a minute at most', async () => {
    features = ['events'];
    await open();
    await run(FIVE_MINUTES);
    // waits of 1, 2, 4, 8, 16 s, then 30 s each
    expect(eventCalls.length).toBeGreaterThan(5);
    expect(eventCalls.length).toBeLessThanOrEqual(16);
    expect(messageCalls.length).toBeLessThanOrEqual(17);
  });

  it('a stream that opens and closes at once is not reconnected faster than a back-off allows', async () => {
    features = ['events'];
    streamEnds = true;
    await open();
    await run(FIVE_MINUTES);
    expect(eventCalls.length).toBeLessThanOrEqual(16);
    expect(messageCalls.length).toBeLessThanOrEqual(17);
  });
});
