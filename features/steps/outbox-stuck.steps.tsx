// features/steps/outbox-stuck.steps.tsx — runs features/outbox-stuck.feature (mw-o14xubc): the Dexie rows an older
// build left (a photo whose upload the connection cut on every try, typed messages waiting behind it), the real live
// loop, sender, deliver, apiFetch and status line (OutboxNote); fetch, /api/me, the message sync and the chain are
// the doubles, and every round trip takes a phone's time.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chain, setChain, type Chain } from '../../src/chain';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { db } from '../../src/data/db';
import { retryDelay } from '../../src/model/outbox';
import { forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const net = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', uploads: 'cut' as 'cut' | 'ok', posted: [] as string[] }));

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

  /** His queue as the old builds left it: the photo's row has failed six tries (a minute to the next, no reason kept), the typed messages have waited behind it untried. */
  async function hisQueue(): Promise<void> {
    const now = Date.now();
    rows = [
      (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'look at this', files: [photo] }, created: now - 3 * 3600_000, attempts: 6, nextAt: now + retryDelay(6), state: 'pending' })) as number,
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
    await act(async () => settledOutbox());
  }

  Scenario('AC-6: a phone with rows queued under 0.8.55, 0.8.56 and 0.8.57 updates to the fix, comes back Live, and every row is posted within one retry without a reload or discard', ({ Given, And, When, Then }) => {
    Given('the phone holds a photo message queued under 0.8.55 whose upload the connection cut on every try, and typed messages queued behind it under 0.8.56 and 0.8.57', hisQueue);
    And('the phone updates to the fix and the backend answers everything again', () => {
      net.uploads = 'ok';
      updatedToTheFix();
    });
    When('the stream opens and the phone reads Live', streamOpens);
    Then('every row is posted to the backend within one retry', async () => {
      // The typed messages go the moment the Mayor's key is known, ahead of the photo's wait; the photo's upload and its message follow on the first forced try.
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
    Given('the phone holds a photo message queued under 0.8.55 whose upload the connection cut on every try, and typed messages queued behind it under 0.8.56 and 0.8.57', hisQueue);
    And('the phone updates to the fix and the backend answers everything but the upload, which the connection still cuts', () => {
      net.uploads = 'cut';
      updatedToTheFix();
    });
    When('the stream opens and the phone reads Live', streamOpens);
    Then('the typed messages are posted to the backend and the photo message is still pending', async () => {
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
