import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { answersRepo } from '../../src/data/repositories';
import { hideAnsweredNeedsYou } from '../../src/projects/answeredNeedsYou';
import type { Snapshot } from '../../src/services/questions';

function snapshotWithNeedsYou(): Snapshot {
  return {
    written_at: '2026-09-24T20:00:00Z',
    epics: [
      {
        id: 'mw-epic',
        title: 'The epic',
        priority: 'P1',
        status: 'in-progress',
        needs_you: [
          { id: 'mw-epic.1', title: 'Ship now or wait?', asked_at: '2026-09-24T08:00:00Z', recommended: 'ship', options: ['ship', 'wait'] },
          { id: 'mw-epic.2', title: 'Another question', asked_at: '2026-09-24T09:00:00Z', recommended: 'a', options: ['a', 'b'] },
        ],
        landed: [],
        working: [],
        closed_count: 0,
      },
    ],
  };
}

describe('hideAnsweredNeedsYou', () => {
  beforeEach(async () => {
    await db.answers.clear();
  });

  it('leaves needs_you untouched when nothing has been answered', async () => {
    const snapshot = snapshotWithNeedsYou();
    const filtered = await hideAnsweredNeedsYou(snapshot);
    expect(filtered.epics[0].needs_you).toHaveLength(2);
  });

  it('removes a bead once it has an answer row', async () => {
    await answersRepo.save({ bead: 'mw-epic.1', answer: 'ship', txid: 'a'.repeat(64) });
    const filtered = await hideAnsweredNeedsYou(snapshotWithNeedsYou());
    expect(filtered.epics[0].needs_you.map((item) => item.id)).toEqual(['mw-epic.2']);
  });
});
