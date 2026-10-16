// features/steps/view-busy-factory.steps.tsx — runs features/view-busy-factory.feature (mw-7dige5.5): the real
// live.ts loop, events.ts projection, view.ts and its throttle, fed a busy factory's events the way his phone got
// them on 2026-10-14 (a new bead about every minute, steps closing, a hold, a landing, a story closed, the home's
// `view` event every 30 s, pushes and a return to the app). Only the network is a double: apiFetch (the stream,
// GET /api/view), the message sync (which hands back the queued batches, as the real one does once it has
// decrypted them) and /me; the clock is fake, and the view's inflate, the one real-time piece, is held until the clock
// stops (tests/support/held-inflate.ts).
import { act } from '@testing-library/react';
import { PrivateKey, Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db, type EventRow } from '../../src/data/db';
import type { EventBatch } from '../../src/model/events';
import { sealDocument } from '../../src/services/documents';
import { refreshNow, startLive, stopLive } from '../../src/services/live';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { holdInflates, settle } from '../../tests/support/held-inflate';

const net = vi.hoisted(() => ({
  stream: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
  /** every GET /api/view: the reason it gave (?why=), the If-None-Match it carried and when (performance.now()) */
  views: [] as { why: string | null; ifNoneMatch: string | null; at: number }[],
  /** the sealed view the backend serves, and the ETag it serves it under */
  sealed: '',
  etag: '"e1"',
  mayor: '',
  /** the batches the next message sync hands back */
  pending: [] as EventBatch[],
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

holdInflates(); // the view's inflate takes real time: it comes back only when advance() has stopped the clock (mw-ev7oyy.18)

const GOV = PrivateKey.fromHex('45'.repeat(32));
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const encoder = new TextEncoder();
const MINUTE = 60_000;

/** Moves the fake clock once all the work begun has settled, and lets what it set going settle before it returns. */
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

/** One events record on the stream: the home posts it, the stream says `message`, the sync brings its batch. */
async function batch(events: EventRow[]): Promise<void> {
  net.pending.push({ from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events });
  await say(`event: message\ndata: ${JSON.stringify({ seq: events[events.length - 1].seq })}`);
}

const job = () => [event({ kind: 'job', actor: 'todo-remind@laptop', from: 'scheduled', to: 'running' }), event({ kind: 'job', actor: 'todo-remind@laptop', from: 'running', to: 'done' })];

/** What only the home can build, on beads the fixture view holds: a hold, a landing, a story closed. */
const SPECIALS: Record<number, () => EventRow> = {
  3: () => event({ kind: 'bead_changed', bead: 'mw-f758y.30.4', from: 'open', to: 'held', detail: 'status' }),
  5: () => event({ kind: 'bead_changed', bead: 'mw-gq6.131', from: 'running', to: 'landed', detail: 'status' }),
  7: () => event({ kind: 'bead_changed', bead: 'mw-2rbm.11', from: 'open', to: 'closed', detail: 'status' }),
};

/** One busy minute, as on 2026-10-14: a bead filed (a story's step), claimed and closed; the home's view event
 * every 30 s; now and then a hold, a landing or a story closed, a push for a message, a return to the app. */
async function busyMinute(m: number): Promise<void> {
  const step = `mw-mol-${m}`;
  await batch([...job(), event({ kind: 'bead_changed', bead: step, from: '', to: 'open', detail: 'created' })]);
  await advance(10_000);
  if (m === 2 || m === 6) await act(() => refreshNow()); // the service worker's 'sync-inbox' on a push he is looking at
  await advance(10_000);
  await batch([event({ kind: 'bead_changed', bead: step, from: 'open', to: 'claimed', detail: 'status' }), ...(SPECIALS[m] ? [SPECIALS[m]()] : [])]);
  await say('event: view\ndata: {}');
  await advance(20_000);
  await batch([event({ kind: 'bead_changed', bead: step, from: 'claimed', to: 'closed', detail: 'status' }), ...job()]);
  await advance(10_000);
  if (m === 4) {
    document.dispatchEvent(new Event('visibilitychange')); // back to the app
    await advance(0);
  }
  await advance(10_000);
  await say('event: view\ndata: {}');
}

async function busyFor(minutes: number): Promise<void> {
  for (let m = 0; m < minutes; m += 1) await busyMinute(m);
}

async function live(): Promise<void> {
  stopLive();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  net.stream = undefined;
  net.views = [];
  net.pending = [];
  net.etag = '"e1"';
  seq = 0;
  net.mayor = MAYOR.toPublicKey().toString();
  net.sealed = await sealDocument(JSON.stringify(fixtureView()), MAYOR.toHex(), GOV.toPublicKey().toString());
  await Promise.all([db.view.clear(), db.events.clear(), db.settings.clear(), db.messages.clear()]);
  await act(async () => {
    startLive(KEY);
  });
  await advance(0);
  await say(`event: hello\ndata: ${JSON.stringify({ head: 1, view: '"e1"' })}`); // the stream opens naming the view the start just fetched
  expect(net.views).toHaveLength(1);
}

/** The asks that brought the whole view: every one but a probe (If-None-Match: *, answered with a bare 304). */
function wholeFetches(): { why: string | null; at: number }[] {
  return net.views.filter((v) => v.ifNoneMatch !== '*');
}

afterAll(() => {
  stopLive();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/view-busy-factory.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-7dige5.5: ten minutes of a busy factory on a live stream with no gap fetch the view once, at the start', ({ Given, When, Then, And }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('ten minutes pass with the factory busy: new beads, steps closing, a hold, a landing, a story closed, pushes and a return to the app', () => busyFor(10));
    Then('the whole view was fetched once in all', () => {
      expect(wholeFetches()).toHaveLength(1);
    });
    And('every ask for the view said why: the start, and a probe for each return to the app', () => {
      expect(net.views.map((v) => v.why)).toEqual(['start', 'probe']);
    });
  });

  Scenario('mw-7dige5.5: a reconnect whose hello names another view fetches it once, saying reconnect', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('two quiet minutes on the stream drops and comes back naming another view', async () => {
      await advance(2 * MINUTE);
      net.etag = '"e2"';
      net.stream?.close();
      await advance(1_000); // the loop's first backoff, then its sync and a new stream
      await advance(0);
      await say(`event: hello\ndata: ${JSON.stringify({ head: 2, view: '"e2"' })}`);
    });
    Then('two minutes on, the whole view was fetched twice in all, the second saying reconnect', async () => {
      await advance(2 * MINUTE);
      expect(wholeFetches().map((v) => v.why)).toEqual(['start', 'reconnect']);
    });
  });

  Scenario('mw-7dige5.5: a real gap in the seqs fetches the view once, saying gap', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('two quiet minutes on a batch comes that skips seqs', async () => {
      await advance(2 * MINUTE);
      await batch([event({ kind: 'job' })]);
      seq += 5;
      await batch([event({ kind: 'job' })]);
    });
    Then('two minutes on, the whole view was fetched twice in all, the second saying gap', async () => {
      await advance(2 * MINUTE);
      expect(wholeFetches().map((v) => v.why)).toEqual(['start', 'gap']);
    });
  });

  Scenario('mw-7dige5.5: what only the home can build is caught up once, fifteen minutes after the last fetch, saying behind', ({ Given, When, Then }) => {
    Given('the event stream is live and the view was fetched at the start', live);
    When('sixteen minutes pass with the factory busy', () => busyFor(16));
    Then('the whole view was fetched twice in all, the second fifteen minutes after the start, saying behind', () => {
      const fetches = wholeFetches();
      expect(fetches.map((v) => v.why)).toEqual(['start', 'behind']);
      expect(fetches[1].at - fetches[0].at).toBeGreaterThanOrEqual(15 * MINUTE);
      expect(fetches[1].at - fetches[0].at).toBeLessThan(15 * MINUTE + 1_000);
    });
  });
});
