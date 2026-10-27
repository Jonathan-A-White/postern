// tests/unit/bead-screen-release.test.tsx — mw-f758y.28: once he has tapped
// Release (or Hold) the bead screen stops offering it, without waiting for the
// view to republish; a newer view that still says the same thing brings it back.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { answersRepo, beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { formatRoute } from '../../src/nav/route';
import { fixtureView } from '../support/cockpit-fixture';
import { deliverAction } from '../../src/services/deliver';
import { forgetOutboxState } from '../../src/services/outbox';
import { forgetTaps } from '../../src/cockpit/oneTap';

vi.mock('../../src/services/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/deliver')>()),
  deliverAction: vi.fn(async () => ({ txid: 'direct:' + '1'.repeat(64), channel: 'direct' as const })),
}));
vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: new Uint8Array(32), mayorKey: '02' + '11'.repeat(32), direct: true }),
}));

const DEFERRED = 'mw-f758y.31.2';
const OPEN = 'mw-f758y.30.5';

// A tap hands the action to the outbox, which delivers it and, a moment after the button has gone dead,
// writes the remembered answer (ts = that moment, in whole seconds). A test that ends before that write
// leaves it to land in the next test's database, where on a loaded host it replaces the older answer that
// test stored and hides its Release for good (mw-esujxh6). So a test that taps waits for the write.
// `slowWrites` holds each such write back, as a loaded host does, so the wait is proved on a quiet one.
const slowWrites = 300;
const saveAnswer = answersRepo.save.bind(answersRepo);
vi.spyOn(answersRepo, 'save').mockImplementation(async (row) => {
  if (row.txid.startsWith('direct:1')) await new Promise((resolve) => setTimeout(resolve, slowWrites));
  return saveAnswer(row);
});

async function rememberedAfterTap(bead: string): Promise<void> {
  await waitFor(async () => expect((await answersRepo.get(bead))?.answer).toBeDefined());
}

async function storeView(writtenAt: number): Promise<void> {
  const view = fixtureView(writtenAt);
  view.written_at = new Date(writtenAt).toISOString();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: writtenAt });
}

describe('BeadScreen offers Release and Hold only while they still apply', () => {
  beforeEach(async () => {
    vi.mocked(deliverAction).mockClear();
    forgetOutboxState();
    forgetTaps();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
  });
  afterEach(() => cleanup());
  afterAll(() => cleanup());

  it('drops Release as soon as he has tapped it, with no new view', async () => {
    await storeView(Date.now() - 60_000);
    render(<BeadScreen id={DEFERRED} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Release' }));
    await waitFor(() => expect(deliverAction).toHaveBeenCalledWith({ action: 'release', bead: DEFERRED }, expect.anything()));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release' })).toBeNull());
    await rememberedAfterTap(DEFERRED);
  });

  it('shows Release when the remembered release is older than the view that still says deferred', async () => {
    const at = Date.now();
    await answersRepo.save({ bead: DEFERRED, answer: 'release', txid: 'direct:old' });
    await db.answers.update(DEFERRED, { ts: Math.floor(at / 1000) - 600 });
    await storeView(at);
    render(<BeadScreen id={DEFERRED} />);
    expect(await screen.findByRole('button', { name: 'Release' })).toBeInTheDocument();
  });

  it('hides Release when the remembered release is newer than the view', async () => {
    await storeView(Date.now() - 60_000);
    await answersRepo.save({ bead: DEFERRED, answer: 'release', txid: 'direct:new' });
    render(<BeadScreen id={DEFERRED} />);
    await screen.findByLabelText('Actions');
    await screen.findByText('Priority');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release' })).toBeNull());
  });

  it('drops Hold the same way once he has tapped it', async () => {
    await storeView(Date.now() - 60_000);
    render(<BeadScreen id={OPEN} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hold' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull());
    await rememberedAfterTap(OPEN);
  });
});

// mw-t64a3.27: opened cold (a push, a pasted link) the bead may be missing from
// the live view; Back still goes up to its parent, read from the fetched detail.
describe('BeadScreen Back from a bead that is not in the live view', () => {
  beforeEach(async () => {
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function storeDetail(id: string, parent?: string): Promise<void> {
    const detail = { v: 2, id, title: 'A cold bead', type: 'task', status: 'open', priority: 2, ...(parent ? { parent } : {}), comments: [] };
    await beadDetailsRepo.save({ id, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
  }

  it('goes to the Map focused on the parent named by the stored detail', async () => {
    await storeDetail('mw-cold.1', 'mw-p');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<BeadScreen id="mw-cold.1" />);
    await screen.findByLabelText('Relations');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(replace).toHaveBeenCalledWith(null, '', formatRoute({ view: 'map', focus: 'mw-p' }));
    expect(formatRoute({ view: 'map', focus: 'mw-p' })).toBe('?v=map&focus=mw-p');
  });

  it('goes to the plain Map when the detail names no parent', async () => {
    await storeDetail('mw-cold.2');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<BeadScreen id="mw-cold.2" />);
    await screen.findByLabelText('Relations');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(replace).toHaveBeenCalledWith(null, '', '?v=map');
  });
});
