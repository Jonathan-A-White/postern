// tests/unit/outbox-hang.test.ts — mw-gb92lmo AC-1: a deliver that never settles must not hold the lane for
// good. The phone's key polled fine while no POST left it for hours: a direct post timed out, the typed
// post went on to WhatsOnChain, and that fetch had no timeout, so the lane's pass never ended and every
// later kick only set `again`. The real sender, deliver, apiFetch and Dexie; fetch is the only double.
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { API_TIMEOUT_MS } from '../../src/services/apiAuth';
import { enqueue, forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { settlePhone } from '../support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '' }));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

/** Like the browser's fetch: never answers, and rejects with an AbortError once its signal aborts. */
const hangs = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
  });
/** A fetch with no signal handling at all: never settles whatever is done to it. */
const hangsForGood = () => new Promise<Response>(() => {});

const accepted = () => new Response(JSON.stringify({ txid: 'direct:' + 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } });

let backend: { messages: 'hang' | 'ok'; chain: 'hang' | 'hang-for-good'; posted: number };

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function pass(ms: number): Promise<void> {
  for (let spent = 0; spent < ms; spent += 1000) {
    await vi.advanceTimersByTimeAsync(Math.min(1000, ms - spent));
    await letStorageRun();
  }
}

beforeEach(async () => {
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  backend = { messages: 'hang', chain: 'hang', posted: 0 };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(chainConfig.providerBaseUrl)) return backend.chain === 'hang-for-good' ? hangsForGood() : hangs(init);
      if (isChallengeRequest(url)) return Promise.resolve(challengeResponse());
      if (url.endsWith('/messages')) {
        backend.posted += 1;
        return backend.messages === 'ok' ? Promise.resolve(accepted()) : hangs(init);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetOutboxState();
  await settlePhone();
});

describe('a deliver that never settles', () => {
  it.each([
    ['WhatsOnChain answers nothing and honours the abort', 'hang' as const],
    ['WhatsOnChain answers nothing and ignores any abort', 'hang-for-good' as const],
  ])('the lane ends its pass and the row goes on the next try: %s', async (_name, chain) => {
    backend.chain = chain;
    const id = await enqueue({ kind: 'message', payload: { text: 'Is the deploy done?', files: [] } });
    await letStorageRun();
    // The POST goes unanswered (30 s) and the try ends there: since mw-o14xubc a failed direct post is not put on the chain in the same try.
    await pass(API_TIMEOUT_MS * 6);
    const tried = await db.outbox.get(id);
    expect(tried).toMatchObject({ state: 'pending' });
    expect(tried?.attempts).toBeGreaterThanOrEqual(1);
    expect(tried?.nextAt).toBeGreaterThan(0);

    // The backend answers; the row keeps its place and goes on its retry wait, with no reload.
    backend.messages = 'ok';
    await pass(150_000);
    await settledOutbox();
    expect(await db.outbox.get(id)).toMatchObject({ state: 'sent' });
  });

  it('an upload that never settles is a passing trouble too', async () => {
    const id = await enqueue({ kind: 'message', payload: { text: 'a picture', files: [{ name: 'p.png', type: 'image/png', data: btoa('abc') }] } });
    await letStorageRun();
    await pass(API_TIMEOUT_MS * 6);
    const tried = await db.outbox.get(id);
    expect(tried).toMatchObject({ state: 'pending' });
    expect(tried?.attempts).toBeGreaterThanOrEqual(1);
  });
});
