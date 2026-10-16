// features/steps/foreground-unsticks.steps.tsx — runs features/foreground-unsticks.feature (mw-q6n8m0.15):
// the real live.ts loop, apiFetch, fetchMe, message sync and LiveBadge against a stubbed global fetch whose
// backend answers throughout. What sticks is the storage read that starts the sync after the stream drops:
// it never answers (an IndexedDB request stalled by Android freezing the page), so it is no fetch that
// apiFetch's own timeout would cut. The chain road works (readChain finds nothing new); the key, the
// Mayor's key and the view are doubles; the clock is fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { LiveBadge } from '../../src/cockpit/Shell';
import { settingsRepo } from '../../src/data/repositories';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const held = vi.hoisted(() => ({ mayorKey: '' }));
held.mayorKey = PrivateKey.fromRandom().toPublicKey().toString();

vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => 'unchanged'),
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
/** Every /api path the phone asked for, in order (challenges left out). */
let asked: string[] = [];
/** Where `asked` stood when the sync stuck, and when he came back. */
let stuckAt = 0;
let backAt = 0;
/** The open streams' ends, to drop one. */
let streams: ReadableStreamDefaultController<Uint8Array>[] = [];
/** Whether the next read of the messages cursor never answers. */
let stickNext = false;

let visible = true;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });

const readSetting = settingsRepo.get.bind(settingsRepo);
vi.spyOn(settingsRepo, 'get').mockImplementation((key: string) => {
  if (key === 'messages-cursor' && stickNext) {
    stickNext = false;
    return new Promise<never>(() => undefined);
  }
  return readSetting(key);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** An open event stream: a hello, then a ping every PING_MS; it ends when aborted. */
function eventStream(signal: AbortSignal | null | undefined): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streams.push(controller);
      controller.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'));
      const ping = () => {
        try {
          controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        } catch {
          return; // dropped
        }
        timer = setTimeout(ping, PING_MS);
      };
      timer = setTimeout(ping, PING_MS);
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
  if (isChallengeRequest(url)) return Promise.resolve(challengeResponse());
  const path = url.replace(/^.*\/api/, '');
  asked.push(path);
  if (path === '/me') return Promise.resolve(json({ pubkey: '', mayor: held.mayorKey, network: 'testnet', features: ['events', 'direct', 'view'] }));
  if (path === '/events') return Promise.resolve(eventStream(init?.signal));
  if (path.startsWith('/messages')) return Promise.resolve(json({ records: [], next: 0, more: false }));
  if (path.startsWith('/view')) return Promise.resolve(new Response(null, { status: 304 }));
  return Promise.resolve(json({ error: 'not here' }, 404));
}

async function pass(ms: number): Promise<void> {
  await act(async () => {
    for (let spent = 0; spent < ms; spent += 1000) {
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - spent));
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
    }
  });
}

const messagesSince = (at: number) => asked.slice(at).filter((path) => path.startsWith('/messages'));

afterAll(() => {
  stopLive();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const feature = await loadFeature('features/foreground-unsticks.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(() => {
    asked = [];
    streams = [];
    stickNext = false;
    visible = true;
  });
  AfterEachScenario(() => {
    stopLive();
    cleanup();
    vi.useRealTimers();
  });

  const appIsLive = async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init)));
    await act(async () => {
      startLive(new Uint8Array(32).fill(7));
    });
    await pass(2_000);
    render(<LiveBadge />);
    expect(getLiveState().status).toBe('live');
  };

  const streamDropsAndSyncSticks = async () => {
    stickNext = true;
    stuckAt = asked.length;
    await act(async () => {
      streams[streams.length - 1].error(new TypeError('network error'));
    });
    await pass(2_000);
    expect(stickNext).toBe(false); // the sync after the drop began, and is stuck on its first read
    expect(getLiveState().status).toBe('reconnecting');
  };

  Scenario('mw-q6n8m0.15 AC-1: live from the chain with a sync stuck, a return to the app asks for the messages and the line is Live', ({ Given, When, And, Then }) => {
    Given('the app is live and the event stream is open', appIsLive);
    And('the stream drops and the sync after it never finishes', streamDropsAndSyncSticks);
    When('10 seconds pass', () => pass(10_000));
    Then('the badge shows "Live from the chain"', () => {
      expect(screen.getByTestId('live-badge')).toHaveTextContent('Live from the chain');
      expect(messagesSince(stuckAt)).toEqual([]);
    });
    When('he swipes the app away and the backend is answering', async () => {
      visible = false;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await pass(20_000);
    });
    And('he comes back to the app', async () => {
      backAt = asked.length;
      visible = true;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    });
    And('2 seconds pass', () => pass(2_000));
    Then('the home was probed once', () => {
      expect(asked.slice(backAt).filter((path) => path === '/view?why=probe')).toHaveLength(1);
    });
    And('the app asked the backend for the messages again', () => {
      expect(messagesSince(backAt).length).toBeGreaterThan(0);
    });
    And('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
    And('the badge shows "Live"', () => {
      expect(screen.getByTestId('live-badge')).toHaveTextContent(/^Live$/);
    });
  });

  Scenario('mw-q6n8m0.15 AC-2: a sync that never finishes is cut off in bounded time and the next sync goes out', ({ Given, When, And, Then }) => {
    Given('the app is live and the event stream is open', appIsLive);
    And('the stream drops and the sync after it never finishes', streamDropsAndSyncSticks);
    When('70 seconds pass without his leaving the app', () => pass(70_000));
    Then('the app asked the backend for the messages again', () => {
      expect(messagesSince(stuckAt).length).toBeGreaterThan(0);
    });
    And('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
  });

  Scenario('mw-q6n8m0.15 AC-1b: a sync stuck before the app was unlocked again does not keep it on Connecting', ({ Given, When, And, Then }) => {
    Given('the app is live and the event stream is open', appIsLive);
    And('the stream drops and the sync after it never finishes', streamDropsAndSyncSticks);
    When('the app is locked and unlocked again', async () => {
      await act(async () => {
        stopLive();
        startLive(new Uint8Array(32).fill(7));
      });
    });
    And('2 seconds pass', () => pass(2_000));
    Then('the app asked the backend for the messages again', () => {
      expect(messagesSince(stuckAt).length).toBeGreaterThan(0);
    });
    And('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
    And('the badge shows "Live"', () => {
      expect(screen.getByTestId('live-badge')).toHaveTextContent(/^Live$/);
    });
  });
});
