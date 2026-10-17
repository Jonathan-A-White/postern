// features/steps/home-built-cards.steps.tsx — runs features/home-built-cards.feature (mw-ev7oyy.39): the real live.ts
// loop, events.ts projection, view.ts and its throttle, fed an event that raises a card only the home builds (a
// landing, a hold, a story closed, a bead reopened, a hands bead filed). The home publishes the view with the card
// about 27 s later (mw-gq6.476's measure) and says so on the stream's `view` event; the card must be in the stored
// view within a minute of the event, with no Refresh tap. Only the network is a double (as in view-busy-factory).
import { act } from '@testing-library/react';
import { PrivateKey, Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db, type EventRow } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import type { EventBatch } from '../../src/model/events';
import { decodeView, type BeadDetail, type Need, type View } from '../../src/model/view';
import { sealDocument } from '../../src/services/documents';
import { startLive, stopLive } from '../../src/services/live';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { holdInflates, settle } from '../../tests/support/held-inflate';

const net = vi.hoisted(() => ({
  stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  views: [] as { why: string | null; ifNoneMatch: string | null; at: number }[],
  sealed: '',
  etag: '"e1"',
  mayor: '',
  pending: [] as EventBatch[],
  /** the sealed detail the backend serves for a bead, by id */
  details: new Map<string, string>(),
}));

vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/view' || path.startsWith('/view?')) {
      const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
      net.views.push({ why: new URL(path, 'https://postern.test/api/').searchParams.get('why'), ifNoneMatch, at: performance.now() });
      if (ifNoneMatch === '*' || ifNoneMatch === net.etag) return new Response(null, { status: 304, headers: { ETag: net.etag } });
      return new Response(net.sealed, { status: 200, headers: { ETag: net.etag } });
    }
    if (path === '/events') {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            net.stream = controller;
          },
        }),
      };
    }
    const beadId = /^\/beads\/([^/?]+)/.exec(path)?.[1];
    const sealed = beadId ? net.details.get(decodeURIComponent(beadId)) : undefined;
    if (sealed) return new Response(sealed, { status: 200 });
    return new Response('{"error":"not here"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }),
}));
vi.mock('../../src/services/inbox', () => ({
  syncMessages: vi.fn(async () => {
    const events = net.pending;
    net.pending = [];
    return { events };
  }),
}));
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', mayor: net.mayor, network: 'testnet', features: ['events', 'view'] })),
  reconcileMayorKey: vi.fn(async () => ({ pinned: net.mayor, offered: undefined })),
}));

holdInflates();

const GOV = PrivateKey.fromHex('47'.repeat(32));
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const GOV_PUB = GOV.toPublicKey().toString();
const encoder = new TextEncoder();
const SECOND = 1_000;
const MINUTE = 60_000;
const HOME_PUBLISHES_MS = 27 * SECOND;

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await settle();
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  });
}

async function say(block: string): Promise<void> {
  net.stream?.enqueue(encoder.encode(`${block}\n\n`));
  await advance(0);
}

let seq = 0;

function event(extra: Partial<EventRow> & Pick<EventRow, 'kind'>): EventRow {
  seq += 1;
  return { seq, ts: new Date().toISOString(), bead: '', actor: 'mw@laptop', from: '', to: '', detail: '', lane: 'normal', ...extra };
}

async function batch(events: EventRow[]): Promise<void> {
  net.pending.push({ from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events });
  await say(`event: message\ndata: ${JSON.stringify({ seq: events[events.length - 1].seq })}`);
}

const NEED: Pick<Need, 'epic' | 'since' | 'recommended' | 'blocks' | 'steps' | 'waits_for' | 'not_ready' | 'waiting_on'> = {
  epic: 'mw-gq6',
  since: new Date().toISOString(),
  recommended: '',
  blocks: 0,
  steps: [],
  waits_for: 'you',
  not_ready: false,
  waiting_on: [],
};

function verifyCard(bead: string): Need {
  return { ...NEED, kind: 'verify', bead, title: `Verify ${bead}`, text: 'HOW TO CHECK IT: open it.', options: ['Verified'] };
}

/** The view the home publishes: the fixture's, with `needs` added, under a new ETag. */
async function homePublishes(needs: Need[]): Promise<void> {
  const view: View = fixtureView();
  view.needs = [...view.needs, ...needs];
  net.sealed = await sealDocument(JSON.stringify(view), MAYOR.toHex(), GOV_PUB);
  net.etag = '"e2"';
}

async function storedNeeds(): Promise<Need[]> {
  const row = await viewRepo.get();
  return row ? decodeView(row.plaintext).needs : [];
}

async function live(): Promise<void> {
  stopLive();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  net.stream = undefined;
  net.views = [];
  net.pending = [];
  net.details = new Map();
  net.etag = '"e1"';
  seq = 0;
  net.mayor = MAYOR.toPublicKey().toString();
  net.sealed = await sealDocument(JSON.stringify(fixtureView()), MAYOR.toHex(), GOV_PUB);
  await Promise.all([db.view.clear(), db.events.clear(), db.settings.clear(), db.messages.clear(), db.beadDetails.clear()]);
  await act(async () => {
    startLive(KEY);
  });
  await advance(0);
  await say(`event: hello\ndata: ${JSON.stringify({ head: 1, view: '"e1"' })}`);
  expect(net.views).toHaveLength(1);
  await advance(90 * SECOND); // the start's fetch is more than a minute behind: the throttle's window is open
}

function wholeFetches(): { why: string | null; at: number }[] {
  return net.views.filter((v) => v.ifNoneMatch !== '*');
}

/** The event arrives, the home publishes 27 s later (a `view` event), and the minute from the event is played out. */
async function eventThenHomePublishes(events: EventRow[], needs: Need[]): Promise<void> {
  await batch(events);
  await advance(HOME_PUBLISHES_MS);
  await homePublishes(needs);
  await say('event: view\ndata: {}');
  await advance(MINUTE - HOME_PUBLISHES_MS);
}

function secondFetchSaidCard(): void {
  expect(wholeFetches().map((v) => v.why)).toEqual(['start', 'card']);
}

afterAll(() => {
  stopLive();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/home-built-cards.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-ev7oyy.39: the verify card after a landing shows within a minute', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the factory lands a story and the home publishes the view with its verify card 27 seconds later', () =>
      eventThenHomePublishes([event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'landed', detail: 'status' })], [verifyCard('mw-gq6.131')]),
    );
    Then('within a minute of the landing the stored view holds the verify card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'verify' && n.bead === 'mw-gq6.131')).toBe(true);
    });
    And('the whole view was fetched twice in all, the second saying card', secondFetchSaidCard);
  });

  Scenario('mw-ev7oyy.39: the approve card after a hold shows within a minute', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When("the factory holds a live epic's story and the home publishes the view with its approve card 27 seconds later", () =>
      eventThenHomePublishes(
        [event({ kind: 'bead_changed', bead: 'mw-f758y.30.4', from: 'open', to: 'held', detail: 'status' })],
        [{ ...NEED, kind: 'approve', bead: 'mw-f758y.30', epic: 'mw-f758y', title: 'Live view', text: '1 story held for your word.', recommended: 'Release', options: ['Release'] }],
      ),
    );
    Then('within a minute of the hold the stored view holds the approve card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'approve' && n.bead === 'mw-f758y.30')).toBe(true);
    });
    And('the whole view was fetched twice in all, the second saying card', secondFetchSaidCard);
  });

  Scenario('mw-ev7oyy.39: a hands card for a new bead shows within a minute', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('a hitl:hands bead is filed under a story the phone holds and the home publishes the view with its hands card 27 seconds later', async () => {
      const detail: BeadDetail = {
        v: 2, id: 'mw-gq6.200', title: 'Plug in the key', type: 'task', status: 'open', priority: 2, parent: 'mw-gq6', labels: ['hitl', 'hitl:hands'], assignee: '', waits: [], blocks: [], children: [],
        created: new Date().toISOString(), updated: new Date().toISOString(), started: '', closed: '', attempts: 0, description: 'Steps.', acceptance: '', comments: [],
      };
      net.details.set(detail.id, await sealDocument(JSON.stringify(detail), MAYOR.toHex(), GOV_PUB));
      await eventThenHomePublishes(
        [event({ kind: 'bead_changed', bead: 'mw-gq6.200', from: '', to: 'open', detail: 'created' })],
        [{ ...NEED, kind: 'hands', bead: 'mw-gq6.200', title: 'Plug in the key', text: 'Plug it in.', options: [] }],
      );
    });
    Then('within a minute of the filing the stored view holds the hands card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'hands' && n.bead === 'mw-gq6.200')).toBe(true);
    });
    And('the whole view was fetched twice in all, the second saying card', secondFetchSaidCard);
  });

  Scenario('mw-ev7oyy.39: a story closing shows its verify card within a minute', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the factory closes a story and the home publishes the view with its verify card 27 seconds later', () =>
      eventThenHomePublishes([event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'closed', detail: 'status' })], [verifyCard('mw-gq6.131')]),
    );
    Then('within a minute of the closing the stored view holds the verify card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'verify' && n.bead === 'mw-gq6.131')).toBe(true);
    });
    And('the whole view was fetched twice in all, the second saying card', secondFetchSaidCard);
  });

  Scenario('mw-ev7oyy.39: a bead reopened shows the card it raises within a minute', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the factory reopens a closed story and the home publishes the view with its hands card 27 seconds later', () =>
      eventThenHomePublishes(
        [event({ kind: 'bead_changed', bead: 'mw-gq6.130', from: 'closed', to: 'open', detail: 'status' })],
        [{ ...NEED, kind: 'hands', bead: 'mw-gq6.130', title: 'Reopened', text: 'Do it again.', options: [] }],
      ),
    );
    Then('within a minute of the reopening the stored view holds the hands card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'hands' && n.bead === 'mw-gq6.130')).toBe(true);
    });
    And('the whole view was fetched twice in all, the second saying card', secondFetchSaidCard);
  });

  Scenario('mw-ev7oyy.39: the view event came before the batch, so the card still shows within a minute', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the home publishes the view with the verify card and its event comes before the batch that names the landing', async () => {
      await homePublishes([verifyCard('mw-gq6.131')]);
      await say('event: view\ndata: {}');
      await advance(5 * SECOND);
      await batch([event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'landed', detail: 'status' })]);
      await advance(MINUTE - 5 * SECOND);
    });
    Then('within a minute of the landing the stored view holds the verify card', async () => {
      expect((await storedNeeds()).some((n) => n.kind === 'verify' && n.bead === 'mw-gq6.131')).toBe(true);
    });
  });

  Scenario('mw-ev7oyy.39: a burst of landings in one minute fetches the view once', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('ten stories land in one minute and the home publishes the view with their cards', async () => {
      for (let i = 0; i < 10; i += 1) {
        await batch([event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'landed', detail: 'status' })]);
        await advance(2 * SECOND);
      }
      await advance(HOME_PUBLISHES_MS - 20 * SECOND);
      await homePublishes([verifyCard('mw-gq6.131')]);
      await say('event: view\ndata: {}');
      await advance(MINUTE);
    });
    Then('the whole view was fetched twice in all, the second saying card', () => {
      expect(wholeFetches().map((v) => v.why)).toEqual(['start', 'card']);
    });
  });

  Scenario('mw-ev7oyy.39: new beads, claims, jobs and a step closed fetch nothing', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('ten minutes pass with the factory busy but nothing that raises a card', async () => {
      for (let m = 0; m < 10; m += 1) {
        const step = `mw-mol-${m}`;
        await batch([event({ kind: 'job', actor: 'todo-remind@laptop', from: 'scheduled', to: 'running' }), event({ kind: 'bead_changed', bead: step, from: '', to: 'open', detail: 'created' })]);
        await advance(20 * SECOND);
        await batch([event({ kind: 'bead_changed', bead: step, from: 'open', to: 'claimed', detail: 'status' })]);
        await say('event: view\ndata: {}');
        await advance(20 * SECOND);
        await batch([event({ kind: 'bead_changed', bead: step, from: 'claimed', to: 'closed', detail: 'status' })]);
        await say('event: view\ndata: {}');
        await advance(20 * SECOND);
      }
    });
    Then('the whole view was fetched once in all', () => {
      expect(wholeFetches()).toHaveLength(1);
    });
  });

  Scenario('mw-ev7oyy.39: a view event that came before the home published the card leaves the quarter-hour window as the last road', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('the factory lands a story, a view event comes before the home has published its card, and the home publishes it later without another view event', async () => {
      await batch([event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'landed', detail: 'status' })]);
      await advance(5 * SECOND);
      await say('event: view\ndata: {}'); // an earlier publishing: the fetch it brings is the view as it was
      await advance(30 * SECOND);
      await homePublishes([verifyCard('mw-gq6.131')]);
      await advance(15 * MINUTE);
    });
    Then('the view was asked for at the start, saying card on the stale view event, and fifteen minutes after that saying behind, which holds the verify card', async () => {
      const fetches = wholeFetches();
      expect(fetches.map((v) => v.why)).toEqual(['start', 'card', 'behind']);
      expect(fetches[2].at - fetches[1].at).toBeGreaterThanOrEqual(15 * MINUTE);
      expect((await storedNeeds()).some((n) => n.kind === 'verify' && n.bead === 'mw-gq6.131')).toBe(true);
    });
  });
});
