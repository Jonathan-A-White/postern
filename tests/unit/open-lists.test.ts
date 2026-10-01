// tests/unit/open-lists.test.ts — mw-f758y.30: which beads the Grillings and Open maps chips count.
import { describe, expect, it } from 'vitest';
import { indexView } from '../../src/model/tree';
import { firstLine, isGrilling, openGrillings, openMaps } from '../../src/model/openLists';
import { fixtureView } from '../support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

const NOW = Date.parse('2026-10-01T12:00:00Z');

function bead(id: string, extra: Partial<ViewBead>): ViewBead {
  return { ...fixtureView(NOW).beads[0], id, title: id, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', ...extra };
}

function need(beadId: string): Need {
  return { kind: 'question', bead: beadId, epic: beadId, title: beadId, since: '', text: '**Pick one**\n\nwhy', recommended: '', options: [], blocks: 0, steps: [] };
}

function indexOf(beads: ViewBead[], needs: Need[] = []) {
  return indexView({ ...fixtureView(NOW), needs, beads });
}

describe('open grillings', () => {
  it('matches a title that begins Grilling:, any case, and not one that merely mentions it', () => {
    expect(isGrilling(bead('a', { title: 'Grilling: x' }))).toBe(true);
    expect(isGrilling(bead('a', { title: 'grilling: x' }))).toBe(true);
    expect(isGrilling(bead('a', { title: 'After the Grilling: x' }))).toBe(false);
  });

  it('lists open ones only, the one with a card first', () => {
    const index = indexOf(
      [bead('a', { title: 'Grilling: a' }), bead('b', { title: 'Grilling: b' }), bead('c', { title: 'Grilling: c', status: 'closed' }), bead('d', { title: 'Other' })],
      [need('b')],
    );
    const found = openGrillings(index);
    expect(found.map((entry) => entry.bead.id)).toEqual(['b', 'a']);
    expect(found[0].need?.bead).toBe('b');
    expect(found[1].need).toBeUndefined();
  });
});

describe('open maps', () => {
  it('lists open maps that are not grillings, not closed and not folded into Done', () => {
    const map = ['wayfinder:map'];
    const index = indexOf([
      bead('open', { labels: map, type: 'epic' }),
      bead('open.1', { parent: 'open' }),
      bead('grill', { labels: map, title: 'Grilling: x', type: 'epic' }),
      bead('grill.1', { parent: 'grill' }),
      bead('fin', { labels: map, type: 'epic' }),
      bead('fin.1', { parent: 'fin', status: 'closed' }),
      bead('shut', { labels: map, type: 'epic', status: 'closed' }),
      bead('lone', { labels: map }),
      bead('plain', { type: 'epic' }),
    ]);
    expect(openMaps(index).map((b) => b.id)).toEqual(['open', 'lone']);
  });
});

describe('firstLine', () => {
  it('drops Markdown marks and blank lines', () => {
    expect(firstLine('\n\n## **Pick one**\nrest')).toBe('Pick one');
    expect(firstLine('')).toBe('');
  });
});
