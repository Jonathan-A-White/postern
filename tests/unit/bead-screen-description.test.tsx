// mw-xhtcup.12: the bead page shows a bead's description through the Markdown component (a heading and a list
// become elements, not raw '##' and '-'), says 'No description.' when there is none, and lists the beads inside
// it in board order (priority, then the tree's tie-break). Its old guard (tests/unit/bead-screen.test.tsx) went
// with the projects screens.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Utils } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import type { BeadDetail, View, ViewBead } from '../../src/model/view';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const GOVERNOR = '11'.repeat(32);

function bead(id: string, title: string, priority: number, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title, type: 'task', status: 'open', priority, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

function detailOf(b: ViewBead, extra: Partial<BeadDetail> = {}): BeadDetail {
  return { v: 2, id: b.id, title: b.title, type: b.type, status: b.status, priority: b.priority, parent: b.parent, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [], ...extra };
}

async function store(beads: ViewBead[], target: string, detailExtra: Partial<BeadDetail>): Promise<void> {
  const view: View = { v: 2, written_at: '2026-10-08T00:00:00Z', host: 'desktop', hosts: [], needs: [], beads };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  const found = beads.find((b) => b.id === target);
  if (!found) throw new Error('target bead missing');
  await beadDetailsRepo.save({ id: target, plaintext: JSON.stringify(detailOf(found, detailExtra)), fetchedAt: Date.now() });
}

beforeEach(async () => {
  await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
  setKey(new Uint8Array(Utils.toArray(GOVERNOR, 'hex')));
});
afterEach(() => {
  cleanup();
  lock();
});
afterAll(() => cleanup());

const description = () => screen.findByRole('region', { name: 'Description' });

describe('the bead page: description', () => {
  it('renders a Markdown description as a heading and a list, not as raw marks', async () => {
    const story = bead('mw-d.1', 'A story', 2);
    await store([story], story.id, { description: '## Plan\n\nDo the thing.\n\n- first step\n- second step' });
    render(<BeadScreen id={story.id} />);

    const section = await description();
    expect(await within(section).findByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
    const items = within(within(section).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['first step', 'second step']);
    expect(section.textContent).not.toContain('##');
    expect(within(section).queryByText('No description.')).toBeNull();
  });

  it('says "No description." when the bead has none', async () => {
    const story = bead('mw-d.2', 'A bare story', 2);
    await store([story], story.id, { description: '' });
    render(<BeadScreen id={story.id} />);

    const section = await description();
    expect(await within(section).findByText('No description.')).toBeInTheDocument();
    expect(within(section).queryByRole('list')).toBeNull();
  });
});

describe('the bead page: the beads inside it', () => {
  it('lists them P1 before P2, a tie by name', async () => {
    const epic = bead('mw-e', 'The epic', 1, { type: 'epic' });
    await store(
      [epic, bead('mw-e.1', 'Banana', 2, { parent: 'mw-e' }), bead('mw-e.2', 'Urgent', 1, { parent: 'mw-e' }), bead('mw-e.3', 'Cherry', 2, { parent: 'mw-e' }), bead('mw-e.4', 'Date', 2, { parent: 'mw-e' })],
      epic.id,
      { children: [] },
    );
    render(<BeadScreen id={epic.id} />);

    await screen.findByText('Inside');
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.includes('mw-e.'));
    // Ids and titles agree on the tie, so this holds however it is broken; the divergent case is tree-order.test.ts's todo.
    expect(links.map((a) => a.textContent)).toEqual(['mw-e.2Urgent', 'mw-e.1Banana', 'mw-e.3Cherry', 'mw-e.4Date']);
  });
});
