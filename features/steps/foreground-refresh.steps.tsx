// features/steps/foreground-refresh.steps.tsx — runs features/foreground-refresh.feature
// (mw-t64a3.17): the real live.ts loop; only the network (apiFetch, the syncs,
// the /me answer) is a double, and the clock is fake so a stream can go quiet.
import { act } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { startLive, stopLive } from '../../src/services/live';
import { storedView } from '../../src/services/view';
import { db } from '../../src/data/db';

const net = vi.hoisted(() => ({
  streams: 0,
  viewFetches: 0,
  newBead: false,
  delivered: false,
  probes: [] as string[],
}));

vi.mock('../../src/services/apiAuth', () => ({
  // An open stream that says nothing and errors when it is aborted.
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/view') {
      // The home probe (mw-7dige5.1): a bare 304, never the body.
      net.probes.push(new Headers(init?.headers).get('If-None-Match') ?? '');
      return { ok: false, status: 304, body: null };
    }
    net.streams += 1;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      }),
    };
  }),
}));
// The events record the Mayor sent while the app was away: a new bead, which only the home's view can place (mw-7dige5.1).
vi.mock('../../src/services/inbox', () => ({
  syncMessages: vi.fn(async () => {
    if (!net.newBead || net.delivered) return { events: [] };
    net.delivered = true;
    const events = [{ seq: 1, ts: '2026-10-01T12:01:00Z', kind: 'bead_changed', bead: 'mw-eq5nn.4', actor: 'mw@laptop', from: '', to: 'open', detail: 'created', lane: 'normal' }];
    return { events: [{ from: 1, to: 1, lane: 'normal', events }] };
  }),
}));
vi.mock('../../src/services/view', async (importOriginal) => {
  const { viewRepo: repo } = await import('../../src/data/repositories');
  const { fixtureView: fixture } = await import('../../tests/support/cockpit-fixture');
  return {
    ...(await importOriginal<typeof import('../../src/services/view')>()),
    refreshView: vi.fn(async () => {
      net.viewFetches += 1;
      const view = fixture();
      if (net.newBead) view.beads.push({ ...view.beads[0], id: 'mw-eq5nn.4', title: 'Just filed' });
      await repo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
      return 'updated';
    }),
  };
});
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events', 'view'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: undefined, offered: undefined })),
}));
vi.mock('../../src/services/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/vault')>()),
  publicKeyHexFromMasterKey: () => '02' + '11'.repeat(32),
}));

let visible = true;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // IndexedDB answers on setImmediate, which the fake clock leaves alone: let the sync and its projection finish.
    for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

async function appears(): Promise<void> {
  visible = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
}

afterAll(() => {
  stopLive();
  vi.useRealTimers();
});

const feature = await loadFeature('features/foreground-refresh.feature');

describeFeature(feature, ({ BeforeEachScenario, Scenario }) => {
  let before = 0;

  BeforeEachScenario(async () => {
    stopLive();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await db.view.clear();
    net.streams = 0;
    net.viewFetches = 0;
    net.newBead = false;
    net.delivered = false;
    net.probes = [];
    await db.events.clear();
    await db.settings.clear();
    visible = false;
  });

  const connected = async (filed = true) => {
    await act(async () => {
      startLive(new Uint8Array(32).fill(7));
    });
    await settle();
    // The app went to the background; a bead was filed meanwhile.
    net.newBead = filed;
    before = net.viewFetches;
    // Past any debounce left by the start-up sync.
    await settle(10_000);
  };

  Scenario('AC-1: becoming visible syncs the events, which fetch the view once for a new bead, however often it fires', ({ Given, When, Then, And }) => {
    Given('the factory is connected and a bead is filed while the app was away', () => connected());
    When('the app becomes visible', appears);
    And('the app becomes visible again a moment later', async () => {
      await settle(1000);
      await appears();
    });
    Then('the view was fetched once more', () => {
      expect(net.viewFetches - before).toBe(1);
    });
    And('the new bead is in the store', async () => {
      expect((await storedView())?.view.beads.map((b) => b.id)).toContain('mw-eq5nn.4');
    });
  });

  Scenario('AC-1b: coming back from the bfcache syncs the events too', ({ Given, When, Then, And }) => {
    Given('the factory is connected and a bead is filed while the app was away', () => connected());
    When('the page is shown again from the back-forward cache', async () => {
      visible = true;
      window.dispatchEvent(new Event('pageshow'));
      await settle();
    });
    Then('the view was fetched once more', () => {
      expect(net.viewFetches - before).toBe(1);
    });
    And('the new bead is in the store', async () => {
      expect((await storedView())?.view.beads.map((b) => b.id)).toContain('mw-eq5nn.4');
    });
  });

  Scenario('mw-7dige5.1: becoming visible with nothing new fetches no view', ({ Given, When, Then }) => {
    Given('the factory is connected and nothing was filed while the app was away', () => connected(false));
    When('the app becomes visible', appears);
    Then('the view was not fetched again', () => {
      expect(net.viewFetches - before).toBe(0);
    });
  });

  Scenario('mw-7dige5.1: becoming visible asks whether home is up without asking for the view', ({ Given, When, Then }) => {
    Given('the factory is connected and nothing was filed while the app was away', () => connected(false));
    When('the app becomes visible', appears);
    Then('the backend was asked about the view with If-None-Match *, which it answers with no body', () => {
      expect(net.probes).toEqual(['*']);
    });
  });

  Scenario('AC-2: becoming visible with a dead stream reconnects it', ({ Given, When, Then, And }) => {
    Given('the factory is connected and a bead is filed while the app was away', () => connected());
    And('the stream went silent long enough to be dead', async () => {
      // The server pings every 25 s; three minutes of nothing is a suspended socket.
      await settle(180_000);
    });
    When('the app becomes visible', appears);
    Then('the event stream was opened again', () => {
      expect(net.streams).toBe(2);
    });
  });

  Scenario('AC-2b: becoming visible with a healthy stream leaves it be', ({ Given, When, Then }) => {
    Given('the factory is connected and a bead is filed while the app was away', () => connected());
    When('the app becomes visible', appears);
    Then('the event stream was not opened again', () => {
      expect(net.streams).toBe(1);
    });
  });
});
