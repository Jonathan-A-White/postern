// tests/unit/outbox-reached-not-live.test.ts — mw-j4usch0: his phone polled /api/messages every ~40 s and every
// probe was accepted, yet nothing he sent left it for hours and the line said 'Sending when back online'. The live
// status was raised only by an open event stream: an answered sync or probe left it at 'reconnecting' or 'offline',
// the outbox's prompt try fired only on a change to live or polling, and while it read 'offline' a typed post
// skipped the backend and went to WhatsOnChain. The real live loop, sender, deliver and apiFetch; fetch, /api/me,
// the message sync and the chain are the doubles.
import { PrivateKey } from '@bsv/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chain, setChain, type Chain } from '../../src/chain';
import { db } from '../../src/data/db';
import { forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { backendReachable, getLiveState, startLive, stopLive } from '../../src/services/live';
import { retryDelay } from '../../src/model/outbox';
import { settlePhone } from '../support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const net = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', syncOk: false, probes: 0, posted: 0, streams: 0, latencyMs: 200 }));

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
  // The message sync his phone made every ~40 s: answered, or (on his phone, for whatever reason) not ok.
  syncMessagesAndEvents: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, net.latencyMs * 2));
    if (!net.syncOk) throw new Error('The sync did not finish.');
    return { applied: 0, refetched: false };
  }),
}));
vi.mock('../../src/services/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/view')>()),
  refreshView: vi.fn(async () => 'unchanged' as const),
}));

net.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();
const key = net.key;
const realChain: Chain = chain;
const chainSends = vi.fn(async () => {
  throw new Error('WhatsOnChain could not take it.');
});

const accepted = () => new Response(JSON.stringify({ txid: 'direct:' + 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function pass(ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 250) {
    await vi.advanceTimersByTimeAsync(Math.min(250, ms - spent));
    await letStorageRun();
  }
}

function comeBackToTheApp(): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

let stopOutbox: (() => void) | undefined;

beforeEach(async () => {
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  Object.assign(net, { syncOk: false, probes: 0, posted: 0, streams: 0 });
  chainSends.mockClear();
  setChain({ ...realChain, sendText: chainSends, read: vi.fn(async () => ({ rows: [], events: [], failed: 0 })) } as Chain);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // A phone's round trip: the sender's own storage reads finish well before the network answers.
      await new Promise((resolve) => setTimeout(resolve, net.latencyMs));
      if (isChallengeRequest(url)) return challengeResponse();
      // The stream never stays up: his phone's dropped again and again.
      if (url.endsWith('/events')) {
        net.streams += 1;
        throw new TypeError('Failed to fetch');
      }
      if (url.includes('/view?why=probe')) {
        net.probes += 1;
        return new Response(null, { status: 304 });
      }
      if (url.endsWith('/messages')) {
        net.posted += 1;
        return accepted();
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(async () => {
  stopOutbox?.();
  stopOutbox = undefined;
  stopLive();
  await letStorageRun();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setChain(realChain);
  forgetOutboxState();
  await settlePhone();
});

/** His row, already tried and failed six times, so its next try is a minute away: the countdown he saw. */
async function hisRowWaitingAMinute(): Promise<number> {
  const id = await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'Is the deploy done?', files: [] }, created: Date.now(), attempts: 6, state: 'pending', nextAt: Date.now() + retryDelay(6) });
  return id as number;
}

/** The live loop with the stream dropping every time and the syncs after it failing: it reads offline. */
async function offlineWithTheStreamDown(): Promise<void> {
  startLive(key);
  await pass(4_000);
  expect(getLiveState().status).toBe('offline');
}

describe('the backend answers while the live status is not live (mw-j4usch0)', () => {
  it('AC-1/AC-2: a probe that is answered while the status reads offline sends his row at once, to the backend', async () => {
    const id = await hisRowWaitingAMinute();
    await offlineWithTheStreamDown();
    stopOutbox = startOutbox();
    await pass(1_000);
    net.posted = 0;

    // He comes back to the app: the probe is answered, as is every GET after it, but the stream still will not stay up.
    net.syncOk = true;
    comeBackToTheApp();
    await pass(2_000);
    await settledOutbox();

    expect(net.probes).toBeGreaterThan(0);
    // The backend answered: the status no longer says it is out of reach, and the row went to it, not to WhatsOnChain.
    expect(getLiveState().status).not.toBe('offline');
    expect(backendReachable(getLiveState())).toBe(true);
    expect(net.posted).toBe(1);
    expect(chainSends).not.toHaveBeenCalled();
    expect(await db.outbox.get(id)).toMatchObject({ state: 'sent' });
  });

  it('AC-2: a message sync that is answered while the stream is down tries his row at once, not after its minute', async () => {
    const id = await hisRowWaitingAMinute();
    await offlineWithTheStreamDown();
    stopOutbox = startOutbox();
    await pass(1_000);
    net.posted = 0;
    chainSends.mockClear();

    // The poll is answered: the next sync of the loop (its back-off is at most 30 s) succeeds.
    net.syncOk = true;
    await pass(31_000);
    await settledOutbox();

    expect(net.posted).toBe(1);
    expect(chainSends).not.toHaveBeenCalled();
    expect(await db.outbox.get(id)).toMatchObject({ state: 'sent' });
  });
});

describe('the live status names what the backend did (mw-j4usch0 AC-4)', () => {
  it('a sync answered after the status read offline lifts it: the backend is reached, though the stream is down', async () => {
    await offlineWithTheStreamDown();
    expect(backendReachable(getLiveState())).toBe(false);
    net.syncOk = true;
    await pass(31_000);
    expect(getLiveState().status).toBe('reconnecting');
    expect(backendReachable(getLiveState())).toBe(true);
  });

  it('is not reachable while nothing the backend was asked has been answered', async () => {
    await offlineWithTheStreamDown();
    await pass(31_000);
    expect(backendReachable(getLiveState())).toBe(false);
  });
});

