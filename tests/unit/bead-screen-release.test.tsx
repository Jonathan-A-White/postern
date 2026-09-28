// tests/unit/bead-screen-release.test.tsx — mw-f758y.28: once he has tapped
// Release (or Hold) the bead screen stops offering it, without waiting for the
// view to republish; a newer view that still says the same thing brings it back.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { answersRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../support/cockpit-fixture';
import { deliverAction } from '../../src/services/deliver';

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

async function storeView(writtenAt: number): Promise<void> {
  const view = fixtureView(writtenAt);
  view.written_at = new Date(writtenAt).toISOString();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: writtenAt });
}

describe('BeadScreen offers Release and Hold only while they still apply', () => {
  beforeEach(async () => {
    vi.mocked(deliverAction).mockClear();
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  });
  afterEach(() => cleanup());
  afterAll(() => cleanup());

  it('drops Release as soon as he has tapped it, with no new view', async () => {
    await storeView(Date.now() - 60_000);
    render(<BeadScreen id={DEFERRED} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Release' }));
    expect(deliverAction).toHaveBeenCalledWith({ action: 'release', bead: DEFERRED }, expect.anything());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Release' })).toBeNull());
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
  });
});
