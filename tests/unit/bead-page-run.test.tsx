// mw-gq6.177: under a hands step's own comment the bead's page offers the same Run the
// Needs you card has: the same approve call with the same step, and the same rules.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView, handsStep } from '../support/cockpit-fixture';
import { approveHandsStep } from '../../src/cockpit/send';
import type { HandsStep } from '../../src/model/hands';
import type { Need, ViewBead } from '../../src/model/view';

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  approveHandsStep: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));

const BEAD = 'mw-h';
const BLOCKER = 'mw-b';

function viewBead(id: string, title: string, extra: Partial<ViewBead> = {}): ViewBead {
  return { id, title, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

async function store(opts: { ran?: HandsStep['ran']; waits?: boolean } = {}): Promise<HandsStep> {
  const now = Date.now();
  const step = handsStep(BEAD, { id: 'backend-419ee98', host: 'laptop', as: 'user', run: 'systemctl --user restart backend', way_back: '', ...(opts.ran ? { ran: opts.ran } : {}) });
  const need: Need = {
    kind: 'hands', bead: BEAD, epic: '', title: 'Restart the backend', since: new Date(now - 3_600_000).toISOString(), text: '', recommended: '', options: [], blocks: 0, steps: [step],
    ...(opts.waits ? { waits_for: 'factory' as const, not_ready: true, waiting_on: ['Build the runner'] } : { waits_for: 'you' as const }),
  };
  const beads = [viewBead(BEAD, 'Restart the backend', { labels: ['hitl'], waits: opts.waits ? [BLOCKER] : [] }), ...(opts.waits ? [viewBead(BLOCKER, 'Build the runner')] : [])];
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [need], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  const detail = { v: 2, id: BEAD, title: 'Restart the backend', type: 'task', status: 'open', priority: 2, labels: ['hitl'], waits: opts.waits ? [BLOCKER] : [], comments: [{ at: new Date(now - 3_000_000).toISOString(), author: 'mw', text: `HANDS STEP ${step.id} on laptop as user:\n\`\`\`sh\n${step.run}\n\`\`\`` }] };
  await db.beadDetails.put({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: now });
  return step;
}

describe('a hands step on the bead page', () => {
  beforeEach(async () => {
    vi.mocked(approveHandsStep).mockClear();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  });
  afterEach(() => cleanup());
  afterAll(() => cleanup());

  it('offers Run under the step comment, and tapping it approves that step', async () => {
    const step = await store();
    render(<BeadScreen id={BEAD} />);
    const under = await screen.findByLabelText(`Run ${step.id}`);
    await userEvent.click(within(under).getByRole('button', { name: 'Approve and run' }));
    await userEvent.click(within(under).getByRole('button', { name: 'Confirm and run' }));
    expect(approveHandsStep).toHaveBeenCalledWith(BEAD, expect.objectContaining({ id: step.id, sha256: step.sha256 }));
  });

  it('a step that waits shows the same Waits on line and no Run', async () => {
    const step = await store({ waits: true });
    render(<BeadScreen id={BEAD} />);
    const under = await screen.findByLabelText(`Run ${step.id}`);
    expect(under.textContent).toContain('Waits on: Build the runner');
    expect(within(under).queryByRole('button')).toBeNull();
  });

  it('a step that ran shows its result and no Run', async () => {
    const step = await store({ ran: { at: new Date().toISOString(), exit: 0, host: 'laptop' } });
    render(<BeadScreen id={BEAD} />);
    const under = await screen.findByLabelText(`Run ${step.id}`);
    expect(within(under).getByRole('status').textContent).toMatch(/^Ran .*exit 0/);
    expect(within(under).queryByRole('button')).toBeNull();
  });
});
