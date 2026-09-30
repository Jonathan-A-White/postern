// plans/0021: the cockpit's model — the live view decoded (docs/protocol.md §11
// and §12, and an old §7 snapshot turned into the same shape), walked as a tree
// at every zoom, laid out as a dependency graph, and narrowed by one filter.
import { describe, it, expect } from 'vitest';
import { decodeBeadDetail, decodeView, viewFromSnapshot } from '../../src/model/view';
import { ancestors, bucketOf, descendants, epicStats, factoryStats, indexView, isFinished, isMap, splitTopLevel, topLevel } from '../../src/model/tree';
import { layoutGraph } from '../../src/model/graph';
import { describeFilter, EMPTY_FILTER, facets, isEmptyFilter, matchesFilter, newestFirst } from '../../src/model/filter';
import { unsettledNeeds } from '../../src/model/needs';
import { fixtureView } from '../support/cockpit-fixture';
import type { Snapshot } from '../../src/services/questions';
import type { ViewBead } from '../../src/model/view';

const NOW = Date.parse('2026-09-28T12:00:00Z');

describe('decodeView', () => {
  it('reads a v2 view and fills what a producer left out with safe empties', () => {
    const view = decodeView(
      JSON.stringify({ v: 2, written_at: 'w', host: 'desktop', needs: [{ kind: 'question', bead: 'a' }, { kind: 'nonsense' }], beads: [{ id: 'a', priority: 'P1' }, { title: 'no id' }] }),
    );
    expect(view.host).toBe('desktop');
    expect(view.hosts).toEqual([]);
    expect(view.needs).toHaveLength(1);
    expect(view.needs[0].options).toEqual([]);
    expect(view.beads).toHaveLength(1);
    expect(view.beads[0]).toMatchObject({ id: 'a', title: 'a', type: 'task', status: 'open', priority: 1, waits: [], labels: [] });
    expect(view.beads[0].path).toBeUndefined();
  });

  it('refuses anything that is not a version 2 view', () => {
    expect(() => decodeView('{"v":1}')).toThrow('version 2');
    expect(() => decodeView('not json')).toThrow('not JSON');
  });

  it('reads a bead detail with every comment', () => {
    const detail = decodeBeadDetail(JSON.stringify({ v: 2, id: 'x', title: 'X', blocks: ['y'], comments: [{ at: 't', author: 'root', text: 'hi' }] }));
    expect(detail.blocks).toEqual(['y']);
    expect(detail.comments).toEqual([{ at: 't', author: 'root', text: 'hi' }]);
  });
});

describe('viewFromSnapshot', () => {
  it('turns an old §7 snapshot into epics, child beads and needs', () => {
    const snapshot: Snapshot = {
      written_at: 'w',
      epics: [
        {
          id: 'e',
          title: 'E',
          priority: 'P1',
          status: 'open',
          needs_you: [{ id: 'e.1', title: 'Q?', asked_at: 'a', recommended: 'A', options: ['A', 'B'] }],
          landed: [{ id: 'e.2', title: 'L', landed_at: 'l' }],
          working: [{ id: 'e.3', title: 'W', status: 'in_progress', priority: 'P2', updated_at: 'u', waits: [] }],
          closed_count: 5,
        },
      ],
    };
    const view = viewFromSnapshot(snapshot);
    expect(view.beads.map((b) => b.id)).toEqual(['e', 'e.3', 'e.2', 'e.1']);
    expect(view.beads[0]).toMatchObject({ type: 'epic', priority: 1, done_earlier: 4 });
    expect(view.needs.map((n) => n.kind)).toEqual(['question', 'verify']);
    expect(view.needs[0]).toMatchObject({ bead: 'e.1', recommended: 'A', options: ['A', 'B'] });
  });
});

describe('the tree', () => {
  const index = indexView(fixtureView(NOW));

  it('puts children under their parents and keeps the rest as roots', () => {
    expect(index.children.get('mw-f758y.30')?.map((b) => b.id)).toContain('mw-f758y.30.2');
    expect(index.roots.map((b) => b.id)).toEqual(expect.arrayContaining(['mw-f758y', 'mw-2rbm', 'mw-gq6', 'mw-jb2p5']));
  });

  it('sorts a bead into its board column', () => {
    const at = (id: string) => bucketOf(index.byId.get(id)!, index);
    expect(at('mw-f758y.30.2')).toBe('working');
    expect(at('mw-f758y.30.4')).toBe('ready'); // waits only on a closed bead
    expect(at('mw-f758y.30.5')).toBe('blocked');
    expect(at('mw-f758y.31.2')).toBe('held');
    expect(at('mw-2rbm.10')).toBe('needs');
    expect(at('mw-gq6.130')).toBe('needs'); // closed but waiting to be verified
    expect(at('mw-2rbm.9')).toBe('done');
  });

  it('walks up and down', () => {
    expect(ancestors('mw-f758y.30.2', index).map((b) => b.id)).toEqual(['mw-f758y', 'mw-f758y.30']);
    expect(descendants('mw-f758y', index).map((b) => b.id)).toContain('mw-f758y.31.4');
  });

  it("counts an epic's progress including what closed before the window", () => {
    const stats = epicStats('mw-f758y', index);
    expect(stats.counts.working).toBe(2);
    expect(stats.counts.held).toBe(3);
    expect(stats.done).toBe(41 + 1);
    expect(stats.total).toBeGreaterThan(stats.done);
    expect(stats.rigs).toEqual(['millwright', 'postern']);
    expect(stats.needs).toBe(2);
  });

  it('sums the factory', () => {
    const stats = factoryStats(index, new Date(NOW));
    expect(stats.working).toBe(3);
    expect(stats.landedToday).toBe(2);
    expect(stats.needs).toBe(5);
  });

  it('lists maps first at the top of the map', () => {
    const tops = topLevel(index);
    expect(isMap(tops[0])).toBe(true);
    expect(isMap(tops[1])).toBe(true);
    expect(isMap(tops[2])).toBe(false);
  });
});

describe('landed today (mw-gq6.155)', () => {
  const template = fixtureView(NOW).beads[0];
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const H = 3_600_000;
  const closedBead = (id: string, closed: string): ViewBead => ({ ...template, id, title: id, type: 'task', status: 'closed', labels: [], waits: [], parent: undefined, done_earlier: 0, closed });
  const index = indexView({
    ...fixtureView(NOW),
    needs: [],
    beads: [closedBead('t.recent', ago(2 * H)), closedBead('t.old', ago(30 * H)), closedBead('t.week', ago(6 * 24 * H))],
  });
  const now = new Date(NOW);
  const landed: typeof EMPTY_FILTER = { ...EMPTY_FILTER, landedToday: true };
  const ids = (filter: typeof EMPTY_FILTER) => index.view.beads.filter((b) => matchesFilter(b, index, filter, now)).map((b) => b.id);

  it('counts one of three beads closed 2 h, 30 h and 6 days ago', () => {
    expect(factoryStats(index, now).landedToday).toBe(1);
  });

  it('lists exactly the beads the count counted', () => {
    expect(ids(landed)).toEqual(['t.recent']);
    expect(ids(landed).length).toBe(factoryStats(index, now).landedToday);
  });

  it('leaves the Done bucket listing all three', () => {
    expect(ids({ ...EMPTY_FILTER, buckets: ['done'] })).toEqual(['t.recent', 't.old', 't.week']);
  });

  it('is a filter of its own, not an empty one', () => {
    expect(isEmptyFilter(landed)).toBe(false);
    expect(describeFilter(landed)).toBe('landed today');
  });
});

describe('a finished epic or map', () => {
  const template = fixtureView(NOW).beads[0];
  const make = (id: string, extra: Partial<ViewBead> = {}): ViewBead => ({ ...template, id, title: id, type: 'task', status: 'open', labels: [], waits: [], parent: undefined, done_earlier: 0, ...extra });
  const epic = make('e', { type: 'epic' });
  const closedChild = make('e.1', { parent: 'e', status: 'closed', closed: '2026-09-28T10:00:00Z' });
  const viewOf = (beads: ViewBead[]) => indexView({ ...fixtureView(NOW), needs: [], beads });

  it('an epic with all children closed is done', () => {
    const index = viewOf([epic, closedChild, make('e.2', { parent: 'e', status: 'closed' })]);
    expect(isFinished(index.byId.get('e')!, index)).toBe(true);
    const { live, done } = splitTopLevel(index);
    expect(done.map((b) => b.id)).toEqual(['e']);
    expect(live).toEqual([]);
  });

  it('a new open child makes it live again', () => {
    const index = viewOf([epic, closedChild, make('e.2', { parent: 'e', status: 'open' })]);
    expect(isFinished(index.byId.get('e')!, index)).toBe(false);
    const { live, done } = splitTopLevel(index);
    expect(live.map((b) => b.id)).toEqual(['e']);
    expect(done).toEqual([]);
  });

  it('an epic with no children in the view is not done', () => {
    const index = viewOf([epic]);
    expect(isFinished(index.byId.get('e')!, index)).toBe(false);
  });

  it('a held child, or a closed one still waiting to be verified, keeps it live', () => {
    const held = viewOf([epic, closedChild, make('e.2', { parent: 'e', status: 'deferred' })]);
    expect(isFinished(held.byId.get('e')!, held)).toBe(false);
    const verify = indexView({
      ...fixtureView(NOW),
      needs: [{ ...fixtureView(NOW).needs[3], bead: 'e.1', epic: 'e' }],
      beads: [epic, closedChild],
    });
    expect(isFinished(verify.byId.get('e')!, verify)).toBe(false);
  });

  it('a child epic must be finished too, and a finished map folds like an epic', () => {
    const map = make('m', { type: 'epic', labels: ['wayfinder:map'] });
    const inner = make('m.1', { type: 'epic', parent: 'm' });
    const open = indexView({ ...fixtureView(NOW), needs: [], beads: [map, inner, make('m.1.1', { parent: 'm.1', status: 'open' })] });
    expect(isFinished(open.byId.get('m')!, open)).toBe(false);
    const closed = indexView({ ...fixtureView(NOW), needs: [], beads: [map, inner, make('m.1.1', { parent: 'm.1', status: 'closed' })] });
    expect(isFinished(closed.byId.get('m')!, closed)).toBe(true);
    expect(splitTopLevel(closed).done.map((b) => b.id)).toEqual(['m']);
  });

  it('the fixture factory folds nothing', () => {
    const index = indexView(fixtureView(NOW));
    expect(splitTopLevel(index).done).toEqual([]);
    expect(splitTopLevel(index).live).toEqual(topLevel(index));
  });
});

describe('layoutGraph', () => {
  it('puts a bead one column right of the latest thing it waits on', () => {
    const layout = layoutGraph([
      { id: 'a', waits: [] },
      { id: 'b', waits: ['a'] },
      { id: 'c', waits: ['a', 'b'] },
      { id: 'd', waits: ['elsewhere'] },
    ]);
    const layer = Object.fromEntries(layout.nodes.map((n) => [n.id, n.layer]));
    expect(layer).toEqual({ a: 0, b: 1, c: 2, d: 0 });
    expect(layout.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['a->b', 'a->c', 'b->c']);
    expect(layout.width).toBeGreaterThan(0);
  });

  it('survives a cycle', () => {
    const layout = layoutGraph([
      { id: 'a', waits: ['b'] },
      { id: 'b', waits: ['a'] },
    ]);
    expect(layout.nodes).toHaveLength(2);
  });
});

describe('filters', () => {
  const index = indexView(fixtureView(NOW));

  it('narrows by words, column, rig and host together', () => {
    const match = (id: string, filter: Partial<typeof EMPTY_FILTER>) => matchesFilter(index.byId.get(id)!, index, { ...EMPTY_FILTER, ...filter });
    expect(match('mw-f758y.30.2', { text: 'events stream' })).toBe(true);
    expect(match('mw-f758y.30.2', { text: 'events banana' })).toBe(false);
    expect(match('mw-f758y.30.2', { buckets: ['working'], rigs: ['postern'], hosts: ['desktop'] })).toBe(true);
    expect(match('mw-f758y.30.2', { buckets: ['ready'] })).toBe(false);
  });

  it('offers the rigs and hosts the view holds', () => {
    expect(facets(index)).toMatchObject({ rigs: ['argus', 'millwright', 'postern', 'spell-forge'], hosts: ['desktop', 'laptop'] });
  });
});

describe('newestFirst', () => {
  const at = (id: string, fields: { updated?: string; closed?: string; started?: string }) => ({ ...indexView(fixtureView(NOW)).byId.get('mw-f758y.30.2')!, id, updated: '', closed: '', started: '', ...fields });

  it('puts the latest activity first, counting updated, started and closed', () => {
    const beads = [
      at('old', { updated: '2026-09-25T10:00:00Z' }),
      at('none', {}),
      at('closed-late', { updated: '2026-09-26T10:00:00Z', closed: '2026-09-28T10:00:00Z' }),
      at('new', { updated: '2026-09-27T10:00:00Z' }),
    ];
    expect(newestFirst(beads).map((bead) => bead.id)).toEqual(['closed-late', 'new', 'old', 'none']);
  });

  it('keeps the snapshot order between beads with the same activity and leaves its input alone', () => {
    const beads = [at('a', { updated: '2026-09-27T10:00:00Z' }), at('b', { updated: '2026-09-27T10:00:00Z' })];
    expect(newestFirst(beads).map((bead) => bead.id)).toEqual(['a', 'b']);
    expect(beads.map((bead) => bead.id)).toEqual(['a', 'b']);
  });
});

describe('unsettledNeeds', () => {
  it('drops a need he answered after it was raised, and keeps one raised since', () => {
    const view = fixtureView(NOW);
    const question = view.needs[0];
    const answeredAfter = [{ bead: question.bead, answer: 'x', txid: 't', ts: Math.floor(Date.parse(question.since) / 1000) + 60 }];
    const answeredBefore = [{ bead: question.bead, answer: 'x', txid: 't', ts: Math.floor(Date.parse(question.since) / 1000) - 60 }];
    expect(unsettledNeeds(view.needs, answeredAfter).map((n) => n.bead)).not.toContain(question.bead);
    expect(unsettledNeeds(view.needs, answeredBefore).map((n) => n.bead)).toContain(question.bead);
  });
});
