// tests/unit/outbox-stuck-rows.test.ts — mw-o14xubc: his phone read 'Unlocked · Live', polled fine, and no POST of
// any kind left it for a day while the status line counted down from a minute and started again. A try that fails
// on the phone's side, or whose request the connection cuts (a photo's upload, as a proxy that drops a too-large
// body gives the browser: a TypeError, not a status), was caught as a passing trouble: nothing of it was kept on
// the row or shown, it was tried once a minute for ever, and every typed message behind it waited in the lane.
// The real sender, deliver, apiFetch and Dexie; fetch and the live status are the doubles.
import { PrivateKey } from '@bsv/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chain, setChain, type Chain } from '../../src/chain';
import { db } from '../../src/data/db';
import { enqueue, failureSlug, failureWhy, failureWords, forgetOutboxState, kickOutbox, settledOutbox } from '../../src/services/outbox';
import { ApiTimeoutError, BackendUnreachableError, RefusedError } from '../../src/services/apiAuth';
import { REPORT_AFTER_ATTEMPTS, REPORT_EVERY_MS, retryDelay } from '../../src/model/outbox';
import { settlePhone } from '../support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', reachable: true }));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true, offline: !held.reachable }),
  // His header: Live, the stream open and every poll answered.
  getLiveState: () => ({ status: held.reachable ? 'live' : 'offline', me: null, reconnects: 0, syncs: 0, reached: held.reachable }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();
const realChain: Chain = chain;
const chainSends = vi.fn(async () => 'cd'.repeat(32));

const accepted = () => new Response(JSON.stringify({ txid: 'direct:' + 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** What the backend saw: every POST that reached it, and every GET /api/view?why= it journaled. */
let backend: { blobs: 'cut' | 'ok'; messages: 'ok' | 'cut'; posted: string[]; whys: string[] };

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function pass(ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 1000) {
    await vi.advanceTimersByTimeAsync(Math.min(1000, ms - spent));
    await letStorageRun();
  }
}

/** A photo as the composer queues it (src/cockpit/send.ts): kept whole, base64, uploaded when its turn comes. */
const photo = { name: 'IMG_4471.jpg', type: 'image/jpeg', data: btoa('not really a jpeg, but bytes') };

beforeEach(async () => {
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  held.reachable = true;
  backend = { blobs: 'cut', messages: 'ok', posted: [], whys: [] };
  chainSends.mockClear();
  setChain({ ...realChain, sendText: chainSends } as Chain);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.includes('/view?why=')) {
        backend.whys.push(url.slice(url.indexOf('why=') + 4));
        return new Response(null, { status: 304 });
      }
      if (url.endsWith('/blobs')) {
        // The proxy in front of the backend drops the body: the browser reports no status, only a TypeError.
        if (backend.blobs === 'cut') throw new TypeError('Failed to fetch');
        backend.posted.push('blob');
        return new Response(JSON.stringify({ hash: 'ef'.repeat(32), size: 28 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/messages') && init?.method === 'POST') {
        if (backend.messages === 'cut') throw new TypeError('Failed to fetch');
        backend.posted.push('message');
        return accepted();
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setChain(realChain);
  forgetOutboxState();
  await settlePhone();
});

/** The queue his phone held: a photo queued under 0.8.55 whose upload is cut every try, and typed messages after it under 0.8.56 and 0.8.57. */
async function hisQueue(): Promise<{ photo: number; typed: number[] }> {
  const photoId = (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'look at this', files: [photo] }, created: Date.now() - 3 * 3600_000, attempts: 6, nextAt: Date.now() + retryDelay(6), state: 'pending' })) as number;
  const typed = [
    (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'did the deploy go?', files: [] }, created: Date.now() - 2 * 3600_000, attempts: 0, state: 'pending' })) as number,
    (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'hello?', files: [] }, created: Date.now() - 3600_000, attempts: 0, state: 'pending' })) as number,
  ];
  return { photo: photoId, typed };
}

describe('a row whose every try fails while the phone reaches the backend (mw-o14xubc)', () => {
  it('AC-1/AC-3: the try that fails before any POST keeps its error on the row: the words, the time and the attempt, and a line to show', async () => {
    const { photo: id } = await hisQueue();
    kickOutbox(true);
    await settledOutbox();
    const row = await db.outbox.get(id);
    expect(row).toMatchObject({ state: 'pending', attempts: 7 });
    expect(row?.error).toMatchObject({ attempt: 7, at: Date.now() });
    expect(row?.error?.message).toMatch(/connection|could not be sent|Failed to fetch/i);
    expect(row?.note).toBeDefined();
    expect(backend.posted).not.toContain('blob');
  });

  it('AC-4: the typed messages behind it go to the backend on the same pass, and it keeps its own wait', async () => {
    const { photo: id, typed } = await hisQueue();
    kickOutbox(true);
    await settledOutbox();
    expect(backend.posted).toEqual(['message', 'message']);
    for (const typedId of typed) expect(await db.outbox.get(typedId)).toMatchObject({ state: 'sent' });
    expect(await db.outbox.get(id)).toMatchObject({ state: 'pending', attempts: 7 });
  });

  it('AC-4: a new message typed behind it goes at once, not after its minute', async () => {
    await hisQueue();
    kickOutbox(true);
    await settledOutbox();
    backend.posted = [];
    await enqueue({ kind: 'message', payload: { text: 'are you there?', files: [] } });
    await letStorageRun();
    await settledOutbox();
    expect(backend.posted).toEqual(['message']);
  });

  it('AC-4: a failure while the backend is out of reach still holds the rows behind it, in order', async () => {
    held.reachable = false;
    backend.messages = 'cut';
    chainSends.mockRejectedValue(new Error('No spendable coins available — fund this wallet before sending a message.'));
    await db.outbox.add({ kind: 'answer', bead: 'mw-a', payload: { answer: 'Yes' }, created: Date.now(), attempts: 0, state: 'pending' });
    await db.outbox.add({ kind: 'answer', bead: 'mw-b', payload: { answer: 'No' }, created: Date.now(), attempts: 0, state: 'pending' });
    kickOutbox(true);
    await settledOutbox();
    expect(backend.posted).toEqual([]);
    const rows = await db.outbox.orderBy('id').toArray();
    expect(rows.map((row) => row.attempts)).toEqual([1, 0]);
  });

  it('AC-2: while reachable, a typed post whose POST fails is never sent on chain, and the row says why', async () => {
    backend.messages = 'cut';
    const id = await enqueue({ kind: 'message', payload: { text: 'hello?', files: [] } });
    await letStorageRun();
    await settledOutbox();
    expect(chainSends).not.toHaveBeenCalled();
    const row = await db.outbox.get(id);
    expect(row).toMatchObject({ state: 'pending', attempts: 1 });
    expect(row?.note).toBeDefined();
    expect(row?.error?.attempt).toBe(1);
  });

  it('AC-5: after three failed tries the phone tells the backend once an hour, by a GET it journals with the row kind and the reason', async () => {
    const id = await enqueue({ kind: 'message', payload: { text: 'look', files: [photo] } });
    await letStorageRun();
    await settledOutbox();
    expect(backend.whys).toEqual([]);
    // Its second and third tries, at their waits.
    await pass(retryDelay(1) + 100);
    await settledOutbox();
    await pass(retryDelay(2) + 100);
    await settledOutbox();
    expect((await db.outbox.get(id))?.attempts).toBe(REPORT_AFTER_ATTEMPTS);
    expect(backend.whys).toEqual(['outbox-message-lost']);
    const reportedAt = (await db.outbox.get(id))?.reportedAt as number;
    expect(reportedAt).toBeGreaterThan(Date.now() - retryDelay(2) - 200);
    expect(reportedAt).toBeLessThanOrEqual(Date.now());
    // More tries within the hour say nothing more; the next after an hour says it again.
    await pass(retryDelay(3) + retryDelay(4) + retryDelay(5) + 300);
    await settledOutbox();
    expect(backend.whys).toHaveLength(1);
    await pass(REPORT_EVERY_MS);
    await settledOutbox();
    expect(backend.whys).toHaveLength(2);
  });

  it('a Talk turn whose try fails on the phone still holds the turn after it', async () => {
    backend.messages = 'cut';
    await db.outbox.add({ kind: 'turn', bead: '', payload: { turn: { talk: { id: 't1', turn: 1 }, text: 'first' } }, created: Date.now(), attempts: 0, state: 'pending' });
    await db.outbox.add({ kind: 'turn', bead: '', payload: { turn: { talk: { id: 't1', turn: 2 }, text: 'second' } }, created: Date.now(), attempts: 0, state: 'pending' });
    kickOutbox(true);
    await settledOutbox();
    const rows = await db.outbox.orderBy('id').toArray();
    expect(rows.map((row) => row.attempts)).toEqual([1, 0]);
    expect(backend.posted).toEqual([]);
  });
});

describe('what a failure is called (mw-o14xubc)', () => {
  it('names the browser\'s fetch failure a cut connection, and keeps any other error\'s own words', () => {
    expect(failureWords(new TypeError('Failed to fetch'))).toBe('The connection was cut before the backend answered.');
    expect(failureWords(new TypeError('Load failed'))).toBe('The connection was cut before the backend answered.');
    expect(failureWords(new TypeError("Cannot read properties of undefined (reading 'slice')"))).toBe("Cannot read properties of undefined (reading 'slice')");
    expect(failureWords(new ApiTimeoutError(true))).toBe('The backend did not answer in time.');
    expect(failureWords(new Error('No spendable coins available — fund this wallet before sending a message.'))).toBe('No spendable coins available — fund this wallet before sending a message.');
    expect(failureWords(new RefusedError('WhatsOnChain said 429', 502))).toBe('WhatsOnChain is busy, trying again…');
  });

  it('gives the journal a why within 24 lower-case characters naming the kind and the reason', () => {
    expect(failureWhy('message', new TypeError('Failed to fetch'))).toBe('outbox-message-lost');
    expect(failureWhy('message', new ApiTimeoutError(false))).toBe('outbox-message-timeout');
    expect(failureWhy('answer', new BackendUnreachableError('gone'))).toBe('outbox-answer-gateway');
    expect(failureWhy('action', new RefusedError('busy', 503))).toBe('outbox-action-http503');
    expect(failureWhy('turn', new Error('No spendable coins available'))).toBe('outbox-turn-nocoins');
    expect(failureWhy('call', new DOMException('bad base64', 'InvalidCharacterError'))).toBe('outbox-call-thrown');
    expect(failureSlug(new RefusedError('WhatsOnChain said 429', 502))).toBe('woc');
    for (const kind of ['answer', 'action', 'turn', 'message', 'call'] as const) {
      for (const err of [new TypeError('Failed to fetch'), new ApiTimeoutError(true), new BackendUnreachableError('x'), new RefusedError('x', 500), new Error('y')]) {
        expect(failureWhy(kind, err)).toMatch(/^[a-z0-9-]{1,24}$/);
      }
    }
  });
});
