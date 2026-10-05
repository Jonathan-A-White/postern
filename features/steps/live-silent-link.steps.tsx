// features/steps/live-silent-link.steps.tsx — runs features/live-silent-link.feature
// (mw-gq6.271): the real live.ts loop, outbox, deliver and apiFetch, the real LiveBadge
// and OutboxNote, against a stubbed global fetch whose link can die without a word (requests
// hang until aborted, the stream stops pinging and never errors) and come back. Only the
// key, the Mayor's key, the syncs and the /me answer are doubles; the clock is fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { LiveBadge } from '../../src/cockpit/Shell';
import { OutboxNote } from '../../src/cockpit/OutboxNote';
import { db } from '../../src/data/db';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { enqueue, forgetOutboxState, settledOutbox, startOutbox } from '../../src/services/outbox';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '', up: true }));

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
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => {
    if (!held.up) throw new Error('The backend did not answer.');
    return { pubkey: '', mayor: held.mayorKey, network: 'testnet', features: ['events', 'direct'] };
  }),
  reconcileMayorKey: vi.fn(async () => ({ pinned: held.mayorKey, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

const PING_MS = 25_000;
let stopOutbox: (() => void) | undefined;

/** An open event stream that pings while the link is up and, when it dies, says nothing and never errors; it ends when aborted. */
function pingingStream(signal: AbortSignal | null | undefined): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const ping = () => {
        if (held.up) controller.enqueue(new TextEncoder().encode(': ping\n\n'));
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
    // Like the browser's fetch over a dead link: nothing comes back, and an abort rejects it.
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
    });
  }
  if (isChallengeRequest(url)) return Promise.resolve(challengeResponse());
  if (url.endsWith('/events')) return Promise.resolve(pingingStream(init?.signal));
  if (url.endsWith('/messages')) return Promise.resolve(new Response(JSON.stringify({ txid: 'direct:' + 'ab'.repeat(32) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  return Promise.resolve(new Response('{}', { status: 200 }));
}

async function pass(ms: number): Promise<void> {
  await act(async () => {
    // The sender and the sync read Dexie (real macrotasks) between timers: give each step of the clock a turn of them.
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

async function connected(): Promise<void> {
  cleanup();
  stopOutbox?.();
  stopLive();
  vi.useRealTimers();
  vi.restoreAllMocks();
  forgetOutboxState();
  await db.outbox.clear();
  held.up = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init)));
  await act(async () => {
    startLive(new Uint8Array(32).fill(7));
    stopOutbox = startOutbox();
  });
  await letStorageRun();
  await pass(1000);
  expect(getLiveState().status).toBe('live');
  render(
    <>
      <LiveBadge />
      <OutboxNote />
    </>,
  );
}

afterAll(() => {
  stopOutbox?.();
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/live-silent-link.feature');

describeFeature(feature, ({ Scenario }) => {
  const notLive = () => expect(getLiveState().status).not.toBe('live');

  Scenario('mw-gq6.271 AC-1: a stream that goes silent without an error stops reading Live', ({ Given, When, And, Then }) => {
    Given('the factory is connected over a link that answers and pings', connected);
    When('the link dies without a word and the pings stop', () => {
      held.up = false;
    });
    And('90 seconds pass', () => pass(90_000));
    Then('the connection does not read "live"', notLive);
    And('the badge shows "Reconnecting…"', () => {
      expect(screen.getByTestId('live-badge')).toHaveTextContent(/Reconnecting…|Offline/);
    });
  });

  Scenario('mw-gq6.271 AC-2: a stream that keeps pinging stays Live', ({ Given, When, Then }) => {
    Given('the factory is connected over a link that answers and pings', connected);
    When('5 minutes pass', () => pass(300_000));
    Then('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
      expect(getLiveState().reconnects).toBe(0);
    });
  });

  Scenario('mw-gq6.271 AC-3: a send that gets no answer queues, the line stops reading Live, and the send goes when the backend answers', ({ Given, When, And, Then }) => {
    Given('the factory is connected over a link that answers and pings', connected);
    When('the link dies without a word and the pings stop', () => {
      held.up = false;
    });
    And('he sends "Is the deploy done?"', async () => {
      await act(async () => {
        await enqueue({ kind: 'message', payload: { text: 'Is the deploy done?', files: [] } });
      });
      await letStorageRun();
    });
    And('30 seconds pass', async () => {
      await pass(30_000);
      await act(async () => settledOutbox());
    });
    Then('the connection does not read "live"', notLive);
    And('the message "Is the deploy done?" is queued and not sent', async () => {
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'message', state: 'pending' });
      expect(rows[0].attempts).toBeGreaterThan(0);
    });
    And('the status line says "Sending when back online"', async () => {
      // The screen's live query re-reads the outbox on a timer of its own.
      await pass(100);
      expect(screen.getByRole('status', { name: 'Outgoing' })).toHaveTextContent('Sending when back online');
    });
    When('the link comes back', () => {
      held.up = true;
    });
    And('2 minutes pass', () => pass(120_000));
    Then('the message "Is the deploy done?" is sent', async () => {
      await act(async () => settledOutbox());
      const rows = await db.outbox.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe('sent');
      expect(rows[0].txid).toMatch(/^direct:/);
    });
    And('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
    And('the status line says nothing', () => {
      expect(screen.queryByRole('status', { name: 'Outgoing' })).toBeNull();
    });
  });
});
