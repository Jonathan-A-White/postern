// tests/unit/outbox-focus-keeps-wait.test.ts — mw-j4usch0 AC-3: his line counted down from 60 s, and every switch
// to another app and back started it again from 60. A return to the app tries the row at once when the backend is
// reached; when that try fails, the row keeps the wait it had, so the countdown goes on from where it was. While the
// backend is not reached a return tries nothing (the probe it makes does, once answered) and the wait stands.
import { PrivateKey } from '@bsv/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import type { LiveState } from '../../src/services/live';
import { retryDelay } from '../../src/model/outbox';
import { settlePhone } from '../support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

const held = vi.hoisted(() => ({
  key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)),
  mayorKey: '',
  live: { status: 'live', me: null, reconnects: 0, syncs: 0 } as LiveState,
}));

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  getLiveState: () => held.live,
  deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

let posted = 0;
let stop: (() => void) | undefined;

async function letStorageRun(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}

function comeBackToTheApp(): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(async () => {
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  posted = 0;
  held.live = { status: 'live', me: null, reconnects: 0, syncs: 0 };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages')) {
        posted += 1;
        // A passing trouble: the row keeps its place and waits for its next try.
        return new Response('{"error":"the backend is busy"}', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetOutboxState();
  await settlePhone();
});

/** His row, tried six times, its next try a minute away. */
async function rowWaitingAMinute(): Promise<{ id: number; nextAt: number }> {
  const nextAt = Date.now() + retryDelay(6);
  const id = (await db.outbox.add({ kind: 'message', bead: '', payload: { text: 'Is the deploy done?', files: [] }, created: Date.now(), attempts: 6, state: 'pending', nextAt })) as number;
  return { id, nextAt };
}

describe('a return to the app (mw-j4usch0 AC-3)', () => {
  it('tries the row at once, and a try that fails leaves the countdown where it was', async () => {
    const { id, nextAt } = await rowWaitingAMinute();
    stop = startOutbox();
    await letStorageRun();
    await vi.advanceTimersByTimeAsync(20_000);
    await letStorageRun();
    expect(posted).toBe(0);

    comeBackToTheApp();
    await letStorageRun();
    await settledOutbox();
    await letStorageRun();

    expect(posted).toBe(1);
    // Forty seconds were left before he switched away; forty are left now, not sixty.
    expect((await db.outbox.get(id))?.nextAt).toBe(nextAt);
  });

  it('tries nothing while the backend is not reached, and the wait stands', async () => {
    held.live = { status: 'offline', me: null, reconnects: 0, syncs: 0 };
    const { id, nextAt } = await rowWaitingAMinute();
    stop = startOutbox();
    await letStorageRun();
    await vi.advanceTimersByTimeAsync(20_000);
    await letStorageRun();

    comeBackToTheApp();
    await letStorageRun();
    await settledOutbox();

    expect(posted).toBe(0);
    expect((await db.outbox.get(id))?.nextAt).toBe(nextAt);
  });

  it('a try at the end of its wait that fails waits its full delay again', async () => {
    const { id, nextAt } = await rowWaitingAMinute();
    stop = startOutbox();
    await letStorageRun();
    await vi.advanceTimersByTimeAsync(retryDelay(6));
    await letStorageRun();
    await settledOutbox();
    await letStorageRun();

    expect(posted).toBe(1);
    expect((await db.outbox.get(id))?.nextAt).toBeGreaterThanOrEqual(nextAt + retryDelay(7));
  });
});
