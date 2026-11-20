// features/steps/live-after-backend-returns.steps.tsx — runs features/live-after-backend-returns.feature (mw-gq6.1570):
// the real live.ts loop, the real message sync (inbox.ts), apiFetch with its real timeouts and the real LiveBadge,
// against a stubbed global fetch. The backend first answers and keeps an event stream open that pings; then it stops
// answering, as the Laptop at load 25-30 behind the VPS's nginx did: the open stream goes silent with no error, and every
// new request waits with no answer until it is aborted. When it answers again, the requests sent while it did not are
// still lost (they wait until the phone gives up on them); only new ones are answered. The chain road works throughout (readChain finds nothing new). The key, the Mayor's key and the view
// are doubles (the view's fetch still goes through apiFetch to the same backend); the clock is fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { LiveBadge } from '../../src/cockpit/Shell';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { apiFetch } from '../../src/services/apiAuth';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ mayorKey: '' }));
held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async (options: { key: Uint8Array; why: string }) => {
    const response = await apiFetch(`/view?why=${options.why}`, { headers: { 'If-None-Match': '*' } }, { unlockedKey: options.key });
    if (!response.ok && response.status !== 304) throw new Error(`The view answered ${response.status}.`);
    return 'unchanged';
  }),
  homeViewPublished: vi.fn(),
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

/** The backend's state: whether it answers, the streams it holds open, and the requests waiting on it. */
const backend = {
  up: true,
  streams: [] as { silence: () => void }[],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** An open event stream that says hello and pings every PING_MS; a host that stops answering stops pinging, with no error. */
function pingingStream(signal: AbortSignal | null | undefined): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'));
      const ping = () => {
        controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        timer = setTimeout(ping, PING_MS);
      };
      timer = setTimeout(ping, PING_MS);
      backend.streams.push({ silence: () => clearTimeout(timer) });
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.error(new DOMException('aborted', 'AbortError'));
      });
    },
    cancel() {
      clearTimeout(timer);
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** What a working backend answers. */
function answerUp(url: string, init?: RequestInit): Response {
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.endsWith('/me')) return json({ pubkey: '', mayor: held.mayorKey, network: 'testnet', features: ['events', 'direct', 'view'] });
  if (url.endsWith('/events')) return pingingStream(init?.signal);
  if (url.includes('/messages?since=')) return json({ records: [], next: 0, more: false });
  if (url.includes('/view?')) return new Response(null, { status: 304 });
  return json({ error: 'not here' }, 503);
}

function answer(url: string, init?: RequestInit): Promise<Response> {
  if (url.startsWith(chainConfig.providerBaseUrl)) return Promise.reject(new TypeError('Failed to fetch'));
  if (backend.up) return Promise.resolve(answerUp(url, init));
  // A host that does not answer: nothing comes back, and an abort rejects it.
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')), { once: true });
  });
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
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/live-after-backend-returns.feature');

describeFeature(feature, ({ ScenarioOutline }) => {
  ScenarioOutline(
    'mw-gq6.1570 AC-1: the stream was live, the backend stopped answering for <outage> seconds and the chain took over; once it answers again the badge reads Live within the back-off, with no reload',
    ({ Given, When, And, Then }, variables) => {
      Given('the factory is connected and the event stream is live', async () => {
        stopLive();
        cleanup();
        vi.useRealTimers();
        await settlePhone();
        backend.up = true;
        backend.streams = [];
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init)));
        await act(async () => {
          startLive(new Uint8Array(32).fill(9));
        });
        await letStorageRun();
        await pass(5_000);
        render(<LiveBadge />);
        expect(getLiveState().status).toBe('live');
        expect(screen.getByTestId('live-badge')).toHaveTextContent(/^Live$/);
      });
      When('the backend stops answering', () => {
        backend.up = false;
        for (const stream of backend.streams) stream.silence();
      });
      And('<outage> seconds pass', () => pass(Number(variables.outage) * 1000));
      Then('the badge shows "Live from the chain"', () => {
        expect(getLiveState().chainLive).toBe(true);
        expect(screen.getByTestId('live-badge')).toHaveTextContent('Live from the chain');
      });
      When('the backend answers again', () => {
        backend.up = true;
      });
      And('30 seconds pass', () => pass(30_000));
      Then('the connection reads "live"', () => {
        expect(getLiveState().status).toBe('live');
      });
      And('the badge shows "Live"', () => {
        expect(screen.getByTestId('live-badge')).toHaveTextContent(/^Live$/);
      });
    },
  );
});
