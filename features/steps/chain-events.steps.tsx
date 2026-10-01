// features/steps/chain-events.steps.tsx — runs features/chain-events.feature (mw-jrx0s.9): the
// real live.ts loop, the real chain read, the real projector (docs/protocol.md §22) and the real
// Map and status badge; only the backend (apiFetch, the sync's paging, /me, the view fetch),
// WhatsOnChain (a faked anchor chain) are doubles, and the timers are fake.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, render, screen } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { MapScreen } from '../../src/cockpit/MapScreen';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import type { EventBatch } from '../../src/model/events';
import { CHAIN_POLL_MS } from '../../src/services/chainRead';
import { subscribeEvents } from '../../src/services/events';
import { getLiveState, startLive, stopLive } from '../../src/services/live';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import { fakeAnchorChain, publicKeyOf, recordTransaction, type FakeAnchorChain } from '../../tests/support/chain-record';

configure({ asyncUtilTimeout: 5000 });

const net = vi.hoisted(() => ({ up: false, page: [] as unknown[], viewCalls: 0 }));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async () => {
    if (!net.up) throw new Error('The network dropped.');
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: hello\ndata: {}\n\n'));
        },
      }),
    };
  }),
}));
vi.mock('../../src/services/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/inbox')>()),
  syncMessages: vi.fn(async () => {
    if (!net.up) throw new Error('The backend did not answer.');
    return { events: net.page.splice(0) };
  }),
}));
vi.mock('../../src/services/view', () => ({
  refreshView: vi.fn(async () => {
    net.viewCalls += 1;
    if (!net.up) throw new Error('The backend did not answer.');
    return 'unchanged';
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: '', network: 'testnet', features: ['events'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: publicKeyOf('77'.repeat(32)), offered: undefined })),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

const PHONE_HEX = '07'.repeat(32);
const MAYOR_HEX = '77'.repeat(32);
const phoneKey = new Uint8Array(PrivateKey.fromHex(PHONE_HEX).toArray());
const EPIC = 'mw-ch';

let chain: FakeAnchorChain;
let applied: number;
let unsubscribe: () => void;
let viewCallsBeforeRead = 0;
let batch: EventBatch;

/** Lets the faked network, Dexie and the loop settle without moving the clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

/** Re-reads the screen until `check` holds: the Map's live query settles a tick or two after the store. */
async function eventually(check: () => void): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      check();
      return;
    } catch (err) {
      last = err;
      await advance(50);
    }
  }
  throw last;
}

function beadIn(id: string, extra: Record<string, unknown>) {
  return { ...fixtureView(Date.now()).beads[0], id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', ...extra };
}

function stateEvent(seq: number, from: string, to: string) {
  return { seq, ts: '2026-10-01T12:01:00Z', kind: 'bead_changed', bead: `${EPIC}.1`, actor: 'mw@laptop', from, to, detail: 'status', lane: 'normal' };
}

function batchOf(events: ReturnType<typeof stateEvent>[]): EventBatch {
  return { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events } as unknown as EventBatch;
}

/** The Mayor's sealed events record, as a transaction on the anchor address. */
function eventsTransaction(events: ReturnType<typeof stateEvent>[]) {
  batch = batchOf(events);
  return recordTransaction({
    senderHex: MAYOR_HEX,
    recipientPublicKeyHex: publicKeyOf(PHONE_HEX),
    class: 'events',
    plaintext: JSON.stringify(batch),
    ts: Math.floor(Date.now() / 1000),
  });
}

async function setUp(_c: unknown, id: string): Promise<void> {
  cleanup();
  stopLive();
  vi.useRealTimers();
  await Promise.all([db.messages.clear(), db.settings.clear(), db.view.clear(), db.events.clear()]);
  net.up = false;
  net.page = [];
  net.viewCalls = 0;
  applied = 0;
  unsubscribe?.();
  unsubscribe = subscribeEvents({}, () => (applied += 1));
  const now = Date.now();
  const view = { ...fixtureView(now), needs: [], beads: [beadIn(EPIC, { type: 'epic' }), beadIn(id, { parent: EPIC })] };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  window.history.replaceState(null, '', `/?v=map&focus=${EPIC}`);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  chain = fakeAnchorChain([]);
  vi.stubGlobal('fetch', chain.fetchImpl);
  render(<MapScreen />);
  await act(async () => {
    startLive(phoneKey);
    await vi.advanceTimersByTimeAsync(0);
  });
  await flush();
  // The loop retries the backend meanwhile; stop just short of the first chain read.
  await advance(CHAIN_POLL_MS - 100);
  viewCallsBeforeRead = net.viewCalls;
}

async function chainRead(events: ReturnType<typeof stateEvent>[]): Promise<void> {
  chain.txs.push(eventsTransaction(events));
  await advance(200);
}

/** The factory pulse's Working figure, the Map's own count of beads in progress. */
const working = (n: number) => () => expect(screen.getByRole('link', { name: /^Working/ })).toHaveTextContent(`Working${n}`);

afterAll(() => {
  stopLive();
  unsubscribe?.();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/chain-events.feature');

describeFeature(feature, ({ Scenario }) => {
  const outOfReach = (_c: unknown, id: string) => setUp(_c, id);
  const starts = () => chainRead([stateEvent(1, 'open', 'claimed')]);
  const statusLine = (_c: unknown, text: string) => eventually(() => expect(screen.getAllByTestId('live-badge')[0]).toHaveTextContent(new RegExp(`^${text}$`)));
  const showsWorking = (_c: unknown, n: number) => eventually(working(n));

  Scenario('mw-jrx0s.9 AC-1: offline, an events transaction on the address updates the Map and the status line says so', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and the Map shows {string} ready', outOfReach);
    When('an events transaction that starts {string} is on the anchor address and the phone reads the chain', starts);
    Then('the Map shows {int} working', showsWorking);
    And('the status line reads {string}', statusLine);
  });

  Scenario('mw-jrx0s.9 AC-2: a batch seen on both roads applies once', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and the Map shows {string} ready', outOfReach);
    When('an events transaction that starts {string} is on the anchor address and the phone reads the chain', starts);
    Then('the Map shows {int} working', showsWorking);
    When('the backend later pages the same batch', async () => {
      net.page = [batch];
      net.up = true;
      await advance(40_000);
    });
    Then('the batch was applied once', async () => {
      expect(applied).toBe(1);
      expect(await db.events.count()).toBe(1);
    });
    And('the events cursor is at {int}', async (_c, seq: number) => {
      expect(await eventsRepo.cursor()).toBe(seq);
    });
  });

  Scenario('mw-jrx0s.9 AC-3: a gap on the chain road is tolerated, with no view fetched', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and the Map shows {string} ready', outOfReach);
    When('an events transaction that starts at seq 5 is on the anchor address and the phone reads the chain', () => chainRead([stateEvent(5, 'open', 'claimed')]));
    Then('the Map shows {int} working', showsWorking);
    And('the view was not fetched', () => {
      expect(net.viewCalls).toBe(viewCallsBeforeRead);
    });
  });

  Scenario('mw-jrx0s.9 AC-4: on reconnect the chain reader stops and paging resumes', ({ Given, When, Then, And }) => {
    Given('the phone cannot reach the backend and the Map shows {string} ready', outOfReach);
    When('an events transaction that starts {string} is on the anchor address and the phone reads the chain', starts);
    Then('the Map shows {int} working', showsWorking);
    When('the event stream comes back and the backend pages the next batch', async () => {
      net.page = [batchOf([stateEvent(2, 'claimed', 'open')])];
      net.up = true;
      await advance(40_000);
    });
    Then('the connection reads {string}', (_c, status: string) => {
      expect(getLiveState().status).toBe(status);
    });
    And('the status line reads {string}', statusLine);
    And('the next batch is applied from the backend', async () => {
      expect(await eventsRepo.cursor()).toBe(2);
      await eventually(working(0));
    });
    And('WhatsOnChain is not asked again', async () => {
      const before = chain.calls.length;
      await advance(120_000);
      expect(chain.calls.length).toBe(before);
    });
  });
});
