// features/steps/after-outage.steps.tsx — runs features/after-outage.feature (mw-gq6.276):
// the real live.ts loop, outbox, deliver and apiFetch, and the real LiveBadge, against a
// stubbed global fetch whose backend gives no answer at all (requests hang until aborted)
// and then answers again. The chain road works throughout (readChain finds nothing new);
// the key, the Mayor's key and the syncs are doubles; the clock is fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { LiveBadge } from '../../src/cockpit/Shell';
import { db } from '../../src/data/db';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { enqueue, forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', up: false }));

held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));
vi.mock('../../src/services/inbox', () => ({
  syncMessages: vi.fn(async () => {
    if (!held.up) throw new Error('The backend did not answer.');
    return { events: [] };
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    if (!held.up) throw new Error('The backend did not answer.');
    return 'unchanged';
  }),
}));
vi.mock('../../src/services/chainRead', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/chainRead')>()),
  readChain: vi.fn(async () => ({ rows: [], events: [], failed: 0 })),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  reconcileMayorKey: vi.fn(async () => ({ pinned: held.mayorKey, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

const PING_MS = 25_000;
let stopOutbox: (() => void) | undefined;
/** Every direct post the backend took. */
const posted: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** An open event stream that pings; it ends when aborted. */
function pingingStream(signal: AbortSignal | null | undefined): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const ping = () => {
        controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        timer = setTimeout(ping, PING_MS);
      };
      ping();
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.error(new DOMException('aborted', 'AbortError'));
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function answer(url: string, init?: RequestInit): Promise<Response> {
  if (url.startsWith(chainConfig.providerBaseUrl)) return Promise.reject(new TypeError('Failed to fetch'));
  if (!held.up) {
    // A backend that gives no answer: nothing comes back, and an abort rejects it.
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
    });
  }
  if (isChallengeRequest(url)) return Promise.resolve(challengeResponse());
  if (url.endsWith('/me')) return Promise.resolve(json({ pubkey: '', mayor: held.mayorKey, network: 'testnet', features: ['events', 'direct', 'view'] }));
  if (url.endsWith('/events')) return Promise.resolve(pingingStream(init?.signal));
  if (url.endsWith('/messages') && init?.method === 'POST') {
    const txid = 'direct:' + (posted.length + 1).toString(16).padStart(64, '0');
    posted.push(txid);
    return Promise.resolve(json({ txid }));
  }
  // Anything else (the chain road's coins, a broadcast) is refused: only the direct road can carry a send here.
  return Promise.resolve(json({ error: 'not here' }, 503));
}

async function pass(ms: number): Promise<void> {
  await act(async () => {
    for (let spent = 0; spent < ms; spent += 1000) {
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - spent));
      await new Promise((resolve) => setImmediate(resolve));
    }
  });
}

async function letStorageRun(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

afterAll(() => {
  stopOutbox?.();
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/after-outage.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-gq6.276 AC-1: the app opens while the backend does not answer, and once it answers the line is Live and what waited goes by the direct road', ({ Given, When, And, Then }) => {
    Given('the app opens while the backend does not answer and the chain does', async () => {
      forgetOutboxState();
      await db.outbox.clear();
      held.up = false;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init)));
      await act(async () => {
        startLive(new Uint8Array(32).fill(7));
        stopOutbox = startOutbox();
      });
      await letStorageRun();
      render(<LiveBadge />);
    });
    And('he sends "Are you there?"', async () => {
      await act(async () => {
        await enqueue({ kind: 'message', payload: { text: 'Are you there?', files: [] } });
      });
      await letStorageRun();
    });
    When('30 seconds pass', () => pass(30_000));
    Then('the badge shows "Live from the chain"', async () => {
      await pass(10_000);
      expect(screen.getByTestId('live-badge')).toHaveTextContent('Live from the chain');
    });
    And('the message "Are you there?" is queued and not sent', async () => {
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'message', state: 'pending' });
    });
    When('the backend answers again', () => {
      held.up = true;
    });
    And('1 minute passes', () => pass(60_000));
    Then('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
      expect(getLiveState().me?.features).toContain('direct');
    });
    And('the badge shows "Live"', () => {
      expect(screen.getByTestId('live-badge')).toHaveTextContent(/^Live$/);
    });
    And('the message "Are you there?" went by the direct road', async () => {
      await act(async () => settledOutbox());
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe('sent');
      expect(rows[0].txid).toMatch(/^direct:/);
      expect(posted).toEqual([rows[0].txid]);
    });
  });
});
