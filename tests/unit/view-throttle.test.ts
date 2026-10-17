// tests/unit/view-throttle.test.ts — mw-7dige5.4: the whole view (~405 KB) is fetched at most once a
// minute, leading and trailing, however many events batches, gaps and refreshes ask for it, and every
// fetch asks with the ETag of the view the phone holds.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db, type EventRow } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import type { EventBatch } from '../../src/model/events';
import type { View, ViewBead } from '../../src/model/view';
import { syncMessagesAndEvents } from '../../src/services/events';
import { sealDocument } from '../../src/services/documents';
import { refreshView, resetViewThrottle, VIEW_BEHIND_INTERVAL_MS, VIEW_MIN_INTERVAL_MS } from '../../src/services/view';
import { MAYOR } from '../support/cockpit-fixture';
import { countInflates, letInflatesGo } from '../support/held-inflate';

const net = vi.hoisted(() => ({
  /** what the next message sync hands back */
  batches: [] as unknown[],
  /** every GET /api/view: when it was asked (ms on the test's clock), why (?why=) and the If-None-Match it carried */
  views: [] as { at: number; why: string | null; ifNoneMatch: string | null }[],
  /** the sealed view the backend serves, and the ETag it serves it under */
  sealed: '',
  etag: '"v1"',
}));

vi.mock('../../src/services/inbox', () => ({
  syncMessages: vi.fn(async () => {
    const events = net.batches;
    net.batches = [];
    return { events };
  }),
}));
vi.mock('../../src/services/apiAuth', () => ({
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.split('?')[0] !== '/view') throw new Error(`unexpected ${path}`);
    const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
    net.views.push({ at: performance.now(), why: new URL(path, 'https://postern.test/api/').searchParams.get('why'), ifNoneMatch });
    if (ifNoneMatch === net.etag) return new Response(null, { status: 304 });
    return new Response(net.sealed, { status: 200, headers: { ETag: net.etag } });
  }),
}));

const GOV = PrivateKey.fromHex('45'.repeat(32));
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();

function bead(id: string, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title: `Title of ${id}`, type: 'task', status: 'in_progress', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

const STORIES = Array.from({ length: 20 }, (_, i) => `mw-s${i + 1}`);

function theView(): View {
  return { v: 2, written_at: '2026-10-13T12:00:00Z', host: 'laptop', hosts: [], needs: [], beads: STORIES.map((id) => bead(id)) };
}

let seq = 0;
function event(extra: Partial<EventRow> & Pick<EventRow, 'kind'>): EventRow {
  seq += 1;
  return { seq, ts: '2026-10-13T12:01:00Z', bead: '', actor: 'mw@laptop', from: '', to: '', detail: '', lane: 'normal', ...extra };
}

function batchOf(events: EventRow[]): EventBatch {
  return { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events };
}

// The view's inflate is zlib on libuv's thread pool and takes real time: a trailing fetch's, which nothing awaits, is
// counted until it is back, so settle() waits for it rather than for a count of turns a loaded host can outrun (mw-ev7oyy.18).
countInflates();

/** Lets every inflate out come back, and fake-indexeddb (which runs on the real setImmediate) and the promise chains
 * behind it settle: 20 turns with no inflate out. */
async function settle(): Promise<void> {
  for (let quiet = 0; quiet < 20; ) {
    if (await letInflatesGo()) quiet = 0;
    else {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise((resolve) => setImmediate(resolve));
      quiet += 1;
    }
  }
}

async function wait(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

const sync = () => syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true });
const refresh = (force = false) => refreshView({ key: KEY, mayorKey: MAYOR_PUB, live: true, why: force ? 'refresh' : 'gap', force });
const behind = () => refreshView({ key: KEY, mayorKey: MAYOR_PUB, live: true, why: 'behind', within: VIEW_BEHIND_INTERVAL_MS });

describe('the view fetch throttle (mw-7dige5.4)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    await Promise.all([db.view.clear(), db.events.clear(), db.settings.clear(), db.messages.clear()]);
    net.batches = [];
    net.views = [];
    net.etag = '"v1"';
    net.sealed = await sealDocument(JSON.stringify(theView()), MAYOR.toHex(), GOV_PUB);
    seq = 0;
    await viewRepo.save({ plaintext: JSON.stringify(theView()), written_at: theView().written_at, etag: '"v0"', source: 'live', fetchedAt: 0 });
    resetViewThrottle();
  });

  afterEach(async () => {
    await settle(); // a trailing fetch's view lands in this test, not on the next one's
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('twenty triggers inside a minute fetch the view twice: at once, and once more when the window ends', async () => {
    const started = performance.now();
    const triggers: (() => Promise<unknown>)[] = [];
    // eight stories close, each one raising a verify card the phone cannot build
    for (let i = 0; i < 8; i++) triggers.push(async () => { net.batches = [batchOf([event({ kind: 'bead_changed', bead: STORIES[i], from: 'claimed', to: 'closed', detail: 'status' })])]; await sync(); });
    // four seq gaps
    for (let i = 8; i < 12; i++) triggers.push(async () => { seq += 3; net.batches = [batchOf([event({ kind: 'bead_changed', bead: STORIES[i], from: 'open', to: 'claimed', detail: 'status' })])]; await sync(); });
    // four cards asked whose question the phone does not hold
    for (let i = 12; i < 16; i++) triggers.push(async () => { net.batches = [batchOf([event({ kind: 'card_asked', bead: STORIES[i], detail: `direct:${i}` })])]; await sync(); });
    // four refreshes
    for (let i = 0; i < 4; i++) triggers.push(() => refresh());
    expect(triggers).toHaveLength(20);

    for (const trigger of triggers) {
      await trigger();
      await wait(2_500);
    }
    expect(net.views.length).toBe(1);
    expect(net.views[0].at - started).toBeLessThan(1_000);

    await wait(VIEW_MIN_INTERVAL_MS);
    expect(net.views.length).toBe(2);
    expect(net.views[1].at - net.views[0].at).toBeGreaterThanOrEqual(VIEW_MIN_INTERVAL_MS);
    await wait(VIEW_MIN_INTERVAL_MS * 3);
    expect(net.views.length).toBe(2);
  });

  it('a trigger after a quiet minute fetches at once again', async () => {
    await refresh();
    await wait(VIEW_MIN_INTERVAL_MS + 1);
    await refresh();
    expect(net.views.length).toBe(2);
  });

  it('a forced fetch (a tap on a Refresh button) goes through inside the window, and still asks with the ETag', async () => {
    await refresh();
    await wait(1_000);
    await refresh(true);
    expect(net.views.length).toBe(2);
    expect(net.views[1].ifNoneMatch).toBe('"v1"');
    await wait(VIEW_MIN_INTERVAL_MS * 2);
    expect(net.views.length).toBe(2); // the forced fetch answered whatever was waiting
  });

  it('after a 200 with ETag B (A held) the next fetch sends If-None-Match: B', async () => {
    net.etag = '"B"';
    await refresh();
    expect(net.views.map((v) => v.ifNoneMatch)).toEqual(['"v0"']);
    expect((await viewRepo.get())?.etag).toBe('"B"');
    await wait(VIEW_MIN_INTERVAL_MS);
    await refresh();
    expect(net.views.map((v) => v.ifNoneMatch)).toEqual(['"v0"', '"B"']);
  });

  it('a new bead the phone cannot place, in an unbroken run, fetches nothing now, and once when a quarter of an hour has passed since the last fetch, saying behind (mw-7dige5.5)', async () => {
    await refresh();
    for (let i = 0; i < 8; i++) {
      net.batches = [batchOf([event({ kind: 'bead_changed', bead: `mw-new${i}`, from: '', to: 'open', detail: 'created' })])];
      await sync(); // its detail cannot be had here: the copy is behind for it
      await wait(VIEW_MIN_INTERVAL_MS);
    }
    expect(net.views.map((v) => v.why)).toEqual(['gap']);
    await wait(VIEW_BEHIND_INTERVAL_MS - 8 * VIEW_MIN_INTERVAL_MS);
    expect(net.views.map((v) => v.why)).toEqual(['gap', 'behind']);
    expect(net.views[1].at - net.views[0].at).toBe(VIEW_BEHIND_INTERVAL_MS);
  });

  it('a story closing every minute asks for the view saying card, at the home\'s publishing (30 s on here), never twice inside a minute (mw-ev7oyy.39)', async () => {
    await refresh();
    for (let i = 0; i < 8; i++) {
      net.batches = [batchOf([event({ kind: 'bead_changed', bead: STORIES[i], from: 'claimed', to: 'closed', detail: 'status' })])];
      await sync();
      await wait(VIEW_MIN_INTERVAL_MS);
    }
    await wait(VIEW_MIN_INTERVAL_MS);
    expect(net.views[0].why).toBe('gap');
    expect(net.views.length).toBeGreaterThan(1);
    expect(net.views.slice(1).every((v) => v.why === 'card')).toBe(true);
    for (let i = 1; i < net.views.length; i++) expect(net.views[i].at - net.views[i - 1].at).toBeGreaterThanOrEqual(VIEW_MIN_INTERVAL_MS);
  });

  it('behind with the last fetch a quarter of an hour old fetches at once', async () => {
    await refresh();
    await wait(VIEW_BEHIND_INTERVAL_MS);
    await behind();
    expect(net.views.map((v) => v.why)).toEqual(['gap', 'behind']);
  });

  it('a sooner fetch takes the place of a waiting behind one, and answers it: a gap inside the minute fetches when the minute ends, and nothing follows (mw-7dige5.5)', async () => {
    await refresh();
    await behind();
    await wait(10_000);
    await refresh();
    await wait(VIEW_MIN_INTERVAL_MS);
    expect(net.views.map((v) => v.why)).toEqual(['gap', 'gap']);
    await wait(VIEW_BEHIND_INTERVAL_MS * 2);
    expect(net.views).toHaveLength(2);
  });

  it('a waiting fetch is kept when a later behind one asks: the minute still ends in one fetch (mw-7dige5.5)', async () => {
    await refresh();
    await refresh();
    await behind();
    await wait(VIEW_MIN_INTERVAL_MS);
    expect(net.views.map((v) => v.why)).toEqual(['gap', 'gap']);
    await wait(VIEW_BEHIND_INTERVAL_MS * 2);
    expect(net.views).toHaveLength(2);
  });
});
