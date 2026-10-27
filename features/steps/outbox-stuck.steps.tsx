// features/steps/outbox-stuck.steps.tsx — runs features/outbox-stuck.feature (mw-o14xubc): the Dexie rows an older
// build left (a camera picture whose upload his weak signal could not finish in the 30 s every request was given, or a
// photo whose upload the connection cut on every try; typed messages waiting behind it), the real live loop, sender,
// deliver, apiFetch and status line (OutboxNote); fetch, /api/me, the message sync and the chain are the doubles, every
// round trip takes a phone's time, and a body crosses his uplink before the backend sees the request.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chain, setChain, type Chain } from '../../src/chain';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { db } from '../../src/data/db';
import { retryDelay } from '../../src/model/outbox';
import { forgetOutboxState, packBytes, settledOutbox, startOutbox } from '../../src/services/outbox';
import { bodyLength, UPLOAD_BYTES_PER_SECOND } from '../../src/services/timedFetch';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const net = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', uploads: 'cut' as 'cut' | 'ok', posted: [] as string[], uplink: Infinity }));

vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => net.key,
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: net.mayorKey, network: 'testnet', features: ['events', 'view', 'direct'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: net.mayorKey, offered: undefined })),
}));
vi.mock('../../src/services/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/events')>()),
  syncMessagesAndEvents: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { applied: 0, refetched: false };
  }),
}));
vi.mock('../../src/services/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/view')>()),
  refreshView: vi.fn(async () => 'unchanged' as const),
}));

net.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();
const realChain: Chain = chain;
const chainSends = vi.fn(async () => {
  throw new Error('WhatsOnChain could not take it.');
});
let rows: number[] = [];
let liveAt = 0;
let stopOutbox: (() => void) | undefined;

/** A photo as the composer queued it under 0.8.55: kept whole, base64, uploaded when its turn comes. */
const photo = { name: 'IMG_4471.jpg', type: 'image/jpeg', data: btoa('not really a jpeg, but bytes') };
/** A camera picture: 400 KB, 40 s over his weak signal (the slowest uplink the app waits for), past the 30 s the old builds gave any request. */
const picture = { name: 'IMG_4472.jpg', type: 'image/jpeg', data: packBytes(new Uint8Array(400_000).map((_, i) => i % 251)) };

/** The time his uplink takes to carry a body, or the browser's AbortError the moment the caller gives up (the body never reaches the backend). */
function carried(bytes: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.ceil((bytes / net.uplink) * 1000));
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    });
  });
}

/** An event stream that opens and stays open, saying nothing. */
function openStream(): Response {
  return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function pass(ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(250, ms - spent));
      for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

/** Passes time until the sender is quiet (a try in flight ends at its own pace) or `maxMs` have gone by. */
async function quiet(maxMs: number): Promise<void> {
  let done = false;
  void settledOutbox().then(() => {
    done = true;
  });
  await pass(0);
  for (let spent = 0; !done && spent < maxMs; spent += 250) await pass(250);
  expect(done).toBe(true);
}

async function fresh(): Promise<void> {
  cleanup();
  stopOutbox?.();
  stopOutbox = undefined;
  stopLive();
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  net.posted = [];
  net.uploads = 'cut';
  net.uplink = Infinity;
  chainSends.mockClear();
  setChain({ ...realChain, sendText: chainSends, read: vi.fn(async () => ({ rows: [], events: [], failed: 0 })) } as Chain);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/events')) return openStream();
      if (url.includes('/view?why=')) return new Response(null, { status: 304 });
      if (url.endsWith('/blobs')) {
        // The proxy in front of the backend drops the body: the browser reports no status, only a TypeError.
        if (net.uploads === 'cut') throw new TypeError('Failed to fetch');
        // The body crosses his uplink first; nginx hands the backend the request only once the whole body is in.
        await carried(bodyLength(init?.body), init?.signal);
        net.posted.push('blob');
        return new Response(JSON.stringify({ hash: 'ef'.repeat(32), size: 28 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/messages') && init?.method === 'POST') {
        net.posted.push('message');
        return new Response(JSON.stringify({ txid: `direct:${'cd'.repeat(28)}${String(net.posted.length).padStart(8, '0')}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

afterAll(async () => {
  stopOutbox?.();
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setChain(realChain);
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
});

const feature = await loadFeature('features/outbox-stuck.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  /** His queue as the old builds left it: the picture's row has failed six tries (a minute to the next, no reason kept), the typed messages have waited behind it untried. */
  async function hisQueue(file: { name: string; type: string; data: string }): Promise<void> {
    const now = Date.now();
    rows = [
      (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'look at this', files: [file] }, created: now - 3 * 3600_000, attempts: 6, nextAt: now + retryDelay(6), state: 'pending' })) as number,
      (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'did the deploy go?', files: [] }, created: now - 2 * 3600_000, attempts: 0, state: 'pending' })) as number,
      (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'hello?', files: [] }, created: now - 3600_000, attempts: 0, state: 'pending' })) as number,
    ];
  }

  /** The fixed build opens over the same rows: the sender and the status line start, as a reload of the app does once. */
  function updatedToTheFix(): void {
    stopOutbox = startOutbox();
    render(<OutboxNote />);
  }

  async function streamOpens(): Promise<void> {
    liveAt = Date.now();
    startLive(net.key);
    await pass(5_000);
    expect(getLiveState().status).toBe('live');
  }

  Scenario('AC-6: a phone with rows queued under 0.8.55, 0.8.56 and 0.8.57 updates to the fix, comes back Live, and every row is posted within one retry without a reload or discard', ({ Given, And, When, Then }) => {
    Given('the phone holds a camera picture queued under 0.8.55 whose upload his weak signal could not finish in the 30 s the old builds allowed, and typed messages queued behind it under 0.8.56 and 0.8.57', async () => {
      net.uplink = UPLOAD_BYTES_PER_SECOND;
      await hisQueue(picture);
    });
    And('the phone updates to the fix and the backend answers everything it is given', () => {
      net.uploads = 'ok';
      updatedToTheFix();
    });
    When('the stream opens and the phone reads Live', streamOpens);
    Then('every row is posted to the backend within one retry', async () => {
      // The stream's opening tries the picture at once, ahead of its wait: its upload crosses the uplink in 40 s and its message
      // follows, then the typed messages; all within the minute its seventh try would have waited.
      await quiet(retryDelay(7));
      expect(net.posted.filter((what) => what === 'message')).toHaveLength(3);
      expect(net.posted.indexOf('blob')).toBeLessThan(net.posted.lastIndexOf('message'));
      for (const id of rows) {
        const row = await db.outbox.get(id);
        expect(row).toMatchObject({ state: 'sent' });
        expect((row?.sentAt as number) - liveAt).toBeLessThan(retryDelay(7));
      }
    });
    And('none went to WhatsOnChain', () => {
      expect(chainSends).not.toHaveBeenCalled();
    });
    And('the status line clears', () => {
      expect(screen.queryByRole('status', { name: 'Outgoing' })).toBeNull();
    });
  });

  Scenario('AC-3: while a row fails every try the status line names the reason after the countdown', ({ Given, And, When, Then }) => {
    Given('the phone holds a photo message queued under 0.8.55 whose upload the connection cut on every try, and typed messages queued behind it under 0.8.56 and 0.8.57', () => hisQueue(photo));
    And('the phone updates to the fix and the backend answers everything but the upload, which the connection still cuts', () => {
      net.uploads = 'cut';
      updatedToTheFix();
    });
    When('the stream opens and the phone reads Live', streamOpens);
    Then('the typed messages are posted to the backend and the photo message is still pending', async () => {
      await quiet(retryDelay(7));
      expect(net.posted).toEqual(['message', 'message']);
      // Tried at least once more (every answered call to the backend tries it again, mw-j4usch0) and still waiting.
      const stuck = await db.outbox.get(rows[0]);
      expect(stuck).toMatchObject({ state: 'pending' });
      expect(stuck?.attempts).toBeGreaterThanOrEqual(7);
      expect(stuck?.error?.message).toBe('Failed to fetch');
      expect(await db.outbox.get(rows[1])).toMatchObject({ state: 'sent' });
      expect(await db.outbox.get(rows[2])).toMatchObject({ state: 'sent' });
    });
    And('the status line says {string} and {string}', async (_c, first: string, second: string) => {
      await pass(1_000);
      const line = screen.getByRole('status', { name: 'Outgoing' });
      expect(line).toHaveTextContent(first);
      expect(line).toHaveTextContent(second);
    });
  });
});
