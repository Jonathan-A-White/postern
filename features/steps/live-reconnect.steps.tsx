// features/steps/live-reconnect.steps.tsx — runs features/live-reconnect.feature
// (mw-t64a3.11): the real live.ts loop and the real LiveBadge; only the network
// (apiFetch, the syncs, the /me answer) is a double, and the backoff runs on
// fake timers.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LiveBadge } from '../../src/cockpit/Shell';
import { getLiveState, startLive, stopLive, subscribeLive, type LiveStatus } from '../../src/services/live';

const net = vi.hoisted(() => ({
  /** what each /events attempt does, in order; the last entry repeats */
  events: [] as Array<'stream' | 'fail'>,
  attempts: 0,
  syncFails: false,
  failSyncAfterDrop: false,
}));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => {
    const step = net.events[Math.min(net.attempts, net.events.length - 1)];
    net.attempts += 1;
    if (step === 'fail') {
      if (net.failSyncAfterDrop) net.syncFails = true;
      throw new Error('The network dropped.');
    }
    return { ok: true, status: 200, body: new ReadableStream<Uint8Array>({ start() {} }) };
  }),
}));
vi.mock('../../src/services/inbox', () => ({
  syncMessages: vi.fn(async () => {
    if (net.syncFails) throw new Error('The backend did not answer.');
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    if (net.syncFails) throw new Error('The backend did not answer.');
    return 'unchanged';
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

let seen: LiveStatus[] = [];
let unsubscribe: (() => void) | undefined;

async function connected(): Promise<void> {
  cleanup();
  stopLive();
  unsubscribe?.();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  net.events = ['fail', 'stream'];
  net.attempts = 0;
  net.syncFails = false;
  net.failSyncAfterDrop = false;
  seen = [];
  unsubscribe = subscribeLive(() => seen.push(getLiveState().status));
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function startAndDrop(): Promise<void> {
  await act(async () => {
    startLive(new Uint8Array(32).fill(7));
    await vi.advanceTimersByTimeAsync(0);
  });
}

afterAll(() => {
  stopLive();
  unsubscribe?.();
  cleanup();
  vi.useRealTimers();
});

const feature = await loadFeature('features/live-reconnect.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: one stream error then a good reconnect never shows offline', ({ Given, When, Then, And }) => {
    Given('the factory is connected and the event stream is live', connected);
    When('the event stream drops once', startAndDrop);
    Then('the connection reads "reconnecting"', () => {
      expect(getLiveState().status).toBe('reconnecting');
    });
    When('the backoff passes and the stream reconnects', async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    });
    Then('the connection reads "live"', () => {
      expect(getLiveState().status).toBe('live');
    });
    And('the connection never read "offline"', () => {
      expect(seen).not.toContain('offline');
      expect(seen).toContain('reconnecting');
    });
  });

  Scenario('AC-2: a stream error, a failed reconnect and a failed sync read offline', ({ Given, When, Then, And }) => {
    Given('the factory is connected and the event stream is live', async () => {
      await connected();
      net.events = ['fail'];
    });
    And('the backend stops answering after the stream drops', () => {
      net.failSyncAfterDrop = true;
    });
    When('the event stream drops once', startAndDrop);
    And('the backoff passes and the reconnect fails', async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    });
    Then('the connection reads "offline"', () => {
      expect(getLiveState().status).toBe('offline');
    });
  });

  Scenario('AC-3: the badge says Reconnecting where it said Offline', ({ Given, When, Then }) => {
    Given('the factory is connected and the event stream is live', connected);
    When('the event stream drops once', async () => {
      await startAndDrop();
      await settle();
    });
    Then('the badge shows "Reconnecting…"', () => {
      render(<LiveBadge />);
      expect(screen.getByTestId('live-badge')).toHaveTextContent('Reconnecting…');
    });
  });
});
