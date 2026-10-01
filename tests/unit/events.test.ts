// tests/unit/events.test.ts — mw-jrx0s.7: the `events` record's batch (docs/protocol.md
// §22, millwright's docs/events.md) decoded, stored once by seq, applied in seq order onto
// the stored view, a gap asking for the view again, and useEvents hearing only its own.
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { db, type EventRow } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { applyBeadDetail, decodeEventBatch, detailAsOf, projectEvents, type EventBatch } from '../../src/model/events';
import { projectBatches, publishEvents, useEvents } from '../../src/services/events';
import { decodeView, type BeadDetail, type Need, type View, type ViewBead } from '../../src/model/view';
import { handsStep } from '../support/cockpit-fixture';

function bead(id: string, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title: `Title of ${id}`, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

function need(extra: Partial<Need> & Pick<Need, 'kind' | 'bead'>): Need {
  return { epic: '', title: '', since: '2026-10-01T10:00:00Z', text: '', recommended: '', options: [], blocks: 0, steps: [], waits_for: 'you', not_ready: false, waiting_on: [], ...extra };
}

function view(beads: ViewBead[], needs: Need[] = []): View {
  return { v: 2, written_at: '2026-10-01T12:00:00Z', host: 'laptop', hosts: [], needs, beads };
}

let nextSeq = 1;
function event(extra: Partial<EventRow> & Pick<EventRow, 'kind'>): EventRow {
  const seq = extra.seq ?? nextSeq++;
  return { seq, ts: '2026-10-01T12:01:00Z', bead: '', actor: 'mw@laptop', from: '', to: '', detail: '', lane: 'normal', ...extra };
}

function batch(events: EventRow[]): EventBatch {
  return { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events };
}

const NO_LOOKUPS = { question: () => undefined, answer: () => undefined };

describe('decodeEventBatch', () => {
  it('reads the batch of docs/events.md, RFC 3339 times, in seq order', () => {
    const text = JSON.stringify({
      from: 41,
      to: 42,
      lane: 'normal',
      events: [
        { seq: 42, ts: '2026-10-01T13:02:07Z', kind: 'card_answered', bead: 'mw-6ww.55', actor: 'mw@laptop', from: 'asked', to: 'answered', detail: 'direct:a7', lane: 'normal' },
        { seq: 41, ts: '2026-10-01T13:02:07Z', kind: 'bead_changed', bead: 'mw-jrx0s.4', actor: 'mw@laptop', from: 'open', to: 'claimed', detail: 'status', lane: 'normal' },
      ],
    });
    const decoded = decodeEventBatch(text);
    expect(decoded.from).toBe(41);
    expect(decoded.to).toBe(42);
    expect(decoded.events.map((e) => e.seq)).toEqual([41, 42]);
    expect(decoded.events[0]).toMatchObject({ kind: 'bead_changed', bead: 'mw-jrx0s.4', from: 'open', to: 'claimed', ts: '2026-10-01T13:02:07Z' });
  });

  it("reads §22's Unix-seconds times too, and leaves out an event with no seq", () => {
    const decoded = decodeEventBatch(JSON.stringify({ from: 1, to: 2, lane: 'emergency', events: [{ seq: 1, ts: 1790000000, kind: 'job' }, { kind: 'job' }] }));
    expect(decoded.events).toHaveLength(1);
    expect(decoded.events[0].ts).toBe(new Date(1790000000 * 1000).toISOString());
    expect(decoded.lane).toBe('emergency');
  });

  it('refuses what is not a batch', () => {
    expect(() => decodeEventBatch('not json')).toThrow();
    expect(() => decodeEventBatch('{"events": []}')).toThrow();
  });
});

describe('projectBatches', () => {
  beforeEach(async () => {
    await Promise.all([db.view.clear(), db.events.clear(), db.settings.clear(), db.messages.clear(), db.answers.clear()]);
    await viewRepo.save({ plaintext: JSON.stringify(view([bead('mw-a')])), written_at: '2026-10-01T12:00:00Z', etag: '"e"', source: 'live', fetchedAt: 1000 });
  });

  const status = async () => decodeView((await viewRepo.get())!.plaintext).beads[0].status;

  it('stores a batch once: the same batch again is a no-op', async () => {
    const once = batch([event({ seq: 1, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })]);
    const first = await projectBatches([once]);
    expect(first.applied.map((e) => e.seq)).toEqual([1]);
    const plaintext = (await viewRepo.get())!.plaintext;

    const again = await projectBatches([once, once]);
    expect(again.applied).toEqual([]);
    expect(again.refetch).toBe(false);
    expect(await db.events.count()).toBe(1);
    expect((await viewRepo.get())!.plaintext).toBe(plaintext);
    expect(await eventsRepo.cursor()).toBe(1);
  });

  it('applies events in seq order, whatever order the batches came in', async () => {
    const claimed = batch([event({ seq: 1, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })]);
    const reopened = batch([event({ seq: 2, kind: 'bead_changed', bead: 'mw-a', from: 'claimed', to: 'open', detail: 'status' })]);
    const result = await projectBatches([reopened, claimed]);
    expect(result.applied.map((e) => e.seq)).toEqual([1, 2]);
    expect(await status()).toBe('open');
    expect(result.refetch).toBe(false);
  });

  it('keeps the view row it projects onto: its written time, fetch time and ETag', async () => {
    await projectBatches([batch([event({ seq: 1, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })])]);
    const row = await viewRepo.get();
    expect(row).toMatchObject({ written_at: '2026-10-01T12:00:00Z', fetchedAt: 1000, etag: '"e"', source: 'live' });
    expect(await status()).toBe('in_progress');
  });

  it('a gap (a batch from past the cursor + 1) asks for the view again and goes on', async () => {
    await eventsRepo.setCursor(3);
    const result = await projectBatches([batch([event({ seq: 7, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })])]);
    expect(result.refetch).toBe(true);
    expect(result.applied.map((e) => e.seq)).toEqual([7]);
    expect(await eventsRepo.cursor()).toBe(7);
    expect((await projectBatches([batch([event({ seq: 8, kind: 'job', from: 'scheduled', to: 'running' })])])).refetch).toBe(false);
  });

  it('a seq at or below the cursor is kept but never applied twice', async () => {
    await eventsRepo.setCursor(5);
    const result = await projectBatches([batch([event({ seq: 5, kind: 'message', bead: 'mw-a' })])]);
    expect(result.applied).toEqual([]);
    expect(decodeView((await viewRepo.get())!.plaintext).beads[0].comments).toBe(0);
  });

  it('with no view stored yet asks for one', async () => {
    await db.view.clear();
    const result = await projectBatches([batch([event({ seq: 1, kind: 'job' })])]);
    expect(result.refetch).toBe(true);
    expect(await eventsRepo.cursor()).toBe(1);
  });

  it('tells useEvents subscribers what it applied', async () => {
    const { result } = renderHook(() => useEvents({ kinds: ['bead_changed'], beads: ['mw-a'] }));
    await act(async () => {
      await projectBatches([batch([event({ seq: 1, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })])]);
    });
    expect(result.current?.seq).toBe(1);
  });
});

describe('projectEvents', () => {
  it('bead_changed moves the status and stamps the times', () => {
    const before = view([bead('mw-a')]);
    const claimed = projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status', ts: '2026-10-01T12:05:00Z' })], NO_LOOKUPS);
    expect(claimed.view.beads[0]).toMatchObject({ status: 'in_progress', started: '2026-10-01T12:05:00Z', updated: '2026-10-01T12:05:00Z' });
    expect(projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'held', detail: 'status' })], NO_LOOKUPS).view.beads[0].status).toBe('deferred');
    expect(before.beads[0].status).toBe('open');
  });

  it('a bead closing drops its own cards and frees the cards that waited on it', () => {
    const before = view(
      [bead('mw-a'), bead('mw-b', { waits: ['mw-a'] })],
      [
        need({ kind: 'question', bead: 'mw-a', options: ['A'] }),
        need({ kind: 'hands', bead: 'mw-b', waits_for: 'factory', not_ready: true, waiting_on: ['Title of mw-a'], steps: [handsStep('mw-b', { id: 's', host: 'desktop', as: 'user', run: 'true', way_back: '' })] }),
      ],
    );
    const after = projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'closed', detail: 'status' })], NO_LOOKUPS);
    expect(after.view.beads[0].status).toBe('closed');
    expect(after.view.beads[1].waits).toEqual([]);
    expect(after.view.needs.map((n) => n.bead)).toEqual(['mw-b']);
    expect(after.view.needs[0]).toMatchObject({ waits_for: 'you', not_ready: false, waiting_on: [] });
    // A story that closes may raise a verify card, which only the home can build.
    expect(after.refetch).toBe(true);
  });

  it('asks for the view where the event cannot say what follows: a bead it does not hold, a landing, a hold', () => {
    const before = view([bead('mw-a')]);
    expect(projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-new', from: '', to: 'open', detail: 'status' })], NO_LOOKUPS).refetch).toBe(true);
    expect(projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'running', to: 'landed', detail: 'status' })], NO_LOOKUPS).refetch).toBe(true);
    expect(projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'held', detail: 'status' })], NO_LOOKUPS).refetch).toBe(true);
  });

  it('a field changed (a title) asks for that bead\'s detail; a comment and a message bump its count', () => {
    const before = view([bead('mw-a')]);
    const titled = projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'open', detail: 'title' })], NO_LOOKUPS);
    expect(titled.details).toEqual(['mw-a']);
    expect(titled.refetch).toBe(false);
    const talked = projectEvents(before, [event({ kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'open', detail: 'comment' }), event({ kind: 'message', bead: 'mw-a', detail: 'direct:aa' })], NO_LOOKUPS);
    expect(talked.view.beads[0].comments).toBe(2);
    expect(talked.details).toEqual([]);
  });

  it('card_asked adds the question the record names; card_answered marks it with the option and time; card_applied drops it', () => {
    const before = view([bead('mw-a', { parent: 'mw-e' }), bead('mw-e', { type: 'epic' })]);
    const lookups = {
      question: (txid: string) => (txid === 'q1' ? { bead: 'mw-a', q: 'Red or blue?', rec: 'Red', options: ['Red', 'Blue'] } : undefined),
      answer: (txid: string) => (txid === 'a1' ? 'Blue' : undefined),
    };
    const asked = projectEvents(before, [event({ kind: 'card_asked', bead: 'mw-a', to: 'asked', detail: 'q1', ts: '2026-10-01T12:03:00Z' })], lookups);
    expect(asked.view.needs).toHaveLength(1);
    expect(asked.view.needs[0]).toMatchObject({ kind: 'question', bead: 'mw-a', epic: 'mw-e', title: 'Title of mw-a', text: 'Red or blue?', recommended: 'Red', options: ['Red', 'Blue'], since: '2026-10-01T12:03:00Z', waits_for: 'you' });

    const answered = projectEvents(asked.view, [event({ kind: 'card_answered', bead: 'mw-a', from: 'asked', to: 'answered', detail: 'a1', ts: '2026-10-01T12:04:00Z' })], lookups);
    expect(answered.view.needs[0].answered).toEqual({ option: 'Blue', at: '2026-10-01T12:04:00Z' });

    const applied = projectEvents(answered.view, [event({ kind: 'card_applied', bead: 'mw-a', from: 'answered', to: 'applied', detail: 'q1' })], lookups);
    expect(applied.view.needs).toEqual([]);
  });

  it('card_asked for a question this phone does not hold asks for the view', () => {
    expect(projectEvents(view([bead('mw-a')]), [event({ kind: 'card_asked', bead: 'mw-a', to: 'asked', detail: 'q9' })], NO_LOOKUPS).refetch).toBe(true);
  });

  it("hands_ran asks for the bead's detail, whose RAN comment fills in the step", () => {
    const step = handsStep('mw-h', { id: 'linger', host: 'desktop', as: 'root', run: 'loginctl enable-linger jwhite', way_back: '' });
    const before = view([bead('mw-h', { labels: ['hitl'] })], [need({ kind: 'hands', bead: 'mw-h', title: 'Title of mw-h', steps: [step] })]);
    const ran = projectEvents(before, [event({ kind: 'hands_ran', bead: 'mw-h', detail: 'linger' })], NO_LOOKUPS);
    expect(ran.details).toEqual(['mw-h']);

    const detail: BeadDetail = {
      v: 2, id: 'mw-h', title: 'Run the linger line', type: 'task', status: 'open', priority: 1, labels: ['hitl'], assignee: '', waits: [], blocks: [], children: [],
      created: '', updated: '2026-10-01T12:06:00Z', started: '', closed: '', attempts: 0, description: '', acceptance: '',
      comments: [{ at: '2026-10-01T12:06:00Z', author: 'mw', text: 'RAN step linger on desktop as root, exit 1 (approved by the Governor via postern, txid direct:aa)\n\nno such user' }],
    };
    const after = applyBeadDetail(ran.view, detail);
    expect(after.beads[0]).toMatchObject({ title: 'Run the linger line', priority: 1, comments: 1, updated: '2026-10-01T12:06:00Z' });
    expect(after.needs[0].title).toBe('Run the linger line');
    expect(after.needs[0].steps[0].ran).toEqual({ at: '2026-10-01T12:06:00Z', exit: 1, host: 'desktop' });
  });
});

describe('useEvents', () => {
  it('notifies a subscriber for its kind and bead, and not for another', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useEvents({ kinds: ['card_answered'], beads: ['mw-a'] });
    });
    const settled = renders;
    act(() => publishEvents([event({ kind: 'card_answered', bead: 'mw-b' }), event({ kind: 'bead_changed', bead: 'mw-a' })]));
    expect(renders).toBe(settled);
    expect(result.current).toBeUndefined();

    const mine = event({ kind: 'card_answered', bead: 'mw-a' });
    act(() => publishEvents([mine]));
    expect(renders).toBe(settled + 1);
    expect(result.current).toEqual(mine);
  });

  it('with no kinds or beads hears every event', () => {
    const { result } = renderHook(() => useEvents({}));
    const any = event({ kind: 'job' });
    act(() => publishEvents([any]));
    expect(result.current).toEqual(any);
  });
});

describe('useEvents details', () => {
  it('hears only events naming one of its details', () => {
    const { result } = renderHook(() => useEvents({ kinds: ['bead_changed'], beads: ['mw-a'], details: ['comment'] }));
    act(() => publishEvents([event({ kind: 'bead_changed', bead: 'mw-a', detail: 'status' })]));
    expect(result.current).toBeUndefined();
    // A comment is heard even when a later event of the same batch is about the same bead.
    const comment = event({ seq: 5, kind: 'bead_changed', bead: 'mw-a', detail: 'comment' });
    act(() => publishEvents([comment, event({ seq: 6, kind: 'bead_changed', bead: 'mw-a', from: 'open', to: 'claimed', detail: 'status' })]));
    expect(result.current).toEqual(comment);
  });
});

describe('detailAsOf', () => {
  const fetched = (extra: Partial<BeadDetail> = {}): BeadDetail => ({
    v: 2, id: 'mw-a', title: 'T', type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], blocks: [], children: [],
    created: '', updated: '2026-10-01T10:00:00Z', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [], ...extra,
  });

  it('takes the status and times of a view copy stamped later', () => {
    const moved = detailAsOf(fetched(), bead('mw-a', { status: 'in_progress', updated: '2026-10-01T11:00:00Z', started: '2026-10-01T11:00:00Z' }));
    expect(moved).toMatchObject({ status: 'in_progress', updated: '2026-10-01T11:00:00Z', started: '2026-10-01T11:00:00Z' });
  });

  it('keeps a detail that is as new as the view, or newer', () => {
    const same = fetched();
    expect(detailAsOf(same, bead('mw-a', { status: 'closed', updated: '2026-10-01T10:00:00Z' }))).toBe(same);
    expect(detailAsOf(same, bead('mw-a', { status: 'closed', updated: '2026-10-01T09:00:00Z' }))).toBe(same);
    expect(detailAsOf(same, bead('mw-a', { status: 'closed', updated: '' }))).toBe(same);
  });

  it('takes a view stamp when the detail has none, and leaves another bead or no bead alone', () => {
    expect(detailAsOf(fetched({ updated: '' }), bead('mw-a', { status: 'closed', updated: '2026-10-01T11:00:00Z' }))?.status).toBe('closed');
    const other = fetched();
    expect(detailAsOf(other, bead('mw-b', { updated: '2026-10-01T11:00:00Z' }))).toBe(other);
    expect(detailAsOf(other, undefined)).toBe(other);
    expect(detailAsOf(undefined, bead('mw-a'))).toBeUndefined();
  });
});
