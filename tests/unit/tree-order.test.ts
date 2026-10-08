// mw-xhtcup.12: the tree puts roots and children in board order: priority first (P1 before P2), then a tie
// by name. Its old guard (tests/unit/grouping.test.ts) went with src/projects/grouping.ts.
import { describe, expect, it } from 'vitest';
import { indexView } from '../../src/model/tree';
import type { View, ViewBead } from '../../src/model/view';

function bead(id: string, title: string, priority: number, parent?: string): ViewBead {
  return { id, title, type: parent ? 'task' : 'epic', status: 'open', priority, parent, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

function viewOf(beads: ViewBead[]): View {
  return { v: 2, written_at: '2026-10-08T00:00:00Z', host: 'desktop', hosts: [], needs: [], beads };
}

const ids = (beads: ViewBead[] | undefined) => (beads ?? []).map((b) => b.id);

describe('indexView ordering (byPriorityThenTitle)', () => {
  it('orders roots P1 before P2, whatever order the view lists them', () => {
    const index = indexView(viewOf([bead('e-p2', 'Alpha', 2), bead('e-p0', 'Zulu', 0), bead('e-p1', 'Mike', 1)]));
    expect(ids(index.roots)).toEqual(['e-p0', 'e-p1', 'e-p2']);
  });

  it('orders the children of one epic P1 before P2', () => {
    const index = indexView(viewOf([bead('epic', 'Epic', 1), bead('epic.1', 'Low', 3, 'epic'), bead('epic.2', 'High', 1, 'epic'), bead('epic.3', 'Middle', 2, 'epic')]));
    expect(ids(index.children.get('epic'))).toEqual(['epic.2', 'epic.3', 'epic.1']);
  });

  it('breaks a priority tie by title, for roots and for children', () => {
    // Ids and titles agree here, so this holds however the tie is broken; the divergent case is the todo below.
    const index = indexView(
      viewOf([bead('r-b', 'Banana', 2), bead('r-a', 'Apple', 2), bead('r-c', 'Cherry', 2), bead('r-a.2', 'Fig', 2, 'r-a'), bead('r-a.1', 'Date', 2, 'r-a')]),
    );
    expect(ids(index.roots)).toEqual(['r-a', 'r-b', 'r-c']);
    expect(ids(index.children.get('r-a'))).toEqual(['r-a.1', 'r-a.2']);
  });

  it('puts priority above title: a P1 titled Zulu comes before a P2 titled Alpha', () => {
    const index = indexView(viewOf([bead('a', 'Alpha', 2), bead('z', 'Zulu', 1)]));
    expect(ids(index.roots)).toEqual(['z', 'a']);
  });

  // FINDING (mw-xhtcup.12): src/model/tree.ts byPriorityThenTitle compares a.id.localeCompare(b.id), not the titles,
  // so two beads of one priority whose id order and title order disagree come out in id order. The story says
  // "ties by title"; no src change is allowed here, so the divergent case waits for a decision.
  it.todo('breaks a priority tie by title even when the ids order the other way (byPriorityThenTitle compares ids)');
});
