// tests/unit/bead-screen-stamp.test.tsx — mw-zuju64.1: a bead with a 'STAMP <txid> for <commit> (testnet)' comment
// shows a Stamp section — short txid, block time, a link to the chain — and what checking it found.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Utils } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stampLimiter } from '../../src/services/stamp';
import { fixtureDetail, fixtureView } from '../support/cockpit-fixture';
import { publicKeyOf, stampTransaction } from '../support/chain-record';
import { stampFetch } from '../support/stamp-fetch';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const BEAD = 'mw-f758y.31.2';
const GOVERNOR = '11'.repeat(32);
const COMMIT = '1fc03343fca689a0c83e2d5019463b332b401ab6';

async function storeBead(stampComment?: string): Promise<void> {
  const view = fixtureView();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  const detail = fixtureDetail(BEAD);
  if (!detail) throw new Error('fixture bead missing');
  if (stampComment) detail.comments.push({ at: '2026-10-05T10:00:00Z', author: 'mw@laptop', text: stampComment });
  await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
}

function rigOfBead(): string {
  const rig = fixtureView().beads.find((b) => b.id === BEAD)?.path?.rig;
  if (!rig) throw new Error('fixture bead has no rig');
  return rig;
}

describe('BeadScreen Stamp section', () => {
  beforeEach(async () => {
    stampLimiter.gapMs = 0;
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
    setKey(new Uint8Array(Utils.toArray(GOVERNOR, 'hex')));
  });
  afterEach(() => {
    cleanup();
    lock();
    vi.unstubAllGlobals();
  });
  afterAll(() => cleanup());

  it('shows no Stamp section on a bead with no STAMP comment', async () => {
    await storeBead();
    const fetched = stampFetch([]);
    vi.stubGlobal('fetch', fetched.fetchImpl);
    render(<BeadScreen id={BEAD} />);
    await screen.findByText('Priority');
    expect(screen.queryByRole('region', { name: 'Stamp' })).toBeNull();
    expect(fetched.calls).toEqual([]);
  });

  it('shows the txid, the block time, the link and Checks out, fetching once', async () => {
    const tx = stampTransaction({ senderHex: '22'.repeat(32), recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig: rigOfBead(), commit: COMMIT });
    await storeBead(`STAMP ${tx.txid} for ${COMMIT} (testnet)`);
    const fetched = stampFetch([tx], 1_790_000_100);
    vi.stubGlobal('fetch', fetched.fetchImpl);
    render(<BeadScreen id={BEAD} />);
    const section = await screen.findByRole('region', { name: 'Stamp' });
    expect(within(section).getByText(`${tx.txid.slice(0, 8)}…${tx.txid.slice(-6)}`)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /View on chain/ })).toHaveAttribute('href', `https://test.whatsonchain.com/tx/${tx.txid}`);
    await waitFor(() => expect(within(section).getByText('Checks out')).toBeInTheDocument());
    expect(within(section).getByText(new Date(1_790_000_100 * 1000).toLocaleString())).toBeInTheDocument();
    expect(fetched.calls.filter((url) => url.endsWith('/hex'))).toHaveLength(1);
  });

  it('says plainly that the commitment does not match', async () => {
    const tx = stampTransaction({ senderHex: '22'.repeat(32), recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig: rigOfBead(), commit: COMMIT.slice(0, -1) + '7' });
    await storeBead(`STAMP ${tx.txid} for ${COMMIT} (testnet)`);
    vi.stubGlobal('fetch', stampFetch([tx], 1_790_000_100).fetchImpl);
    render(<BeadScreen id={BEAD} />);
    const section = await screen.findByRole('region', { name: 'Stamp' });
    await waitFor(() => expect(within(section).getByText('The commitment on chain does not match this commit')).toBeInTheDocument());
    expect(within(section).queryByText('Checks out')).toBeNull();
  });

  it('says it could not reach WhatsOnChain, and that a transaction still in the mempool has no block yet', async () => {
    const tx = stampTransaction({ senderHex: '22'.repeat(32), recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig: rigOfBead(), commit: COMMIT });
    await storeBead(`STAMP ${tx.txid} for ${COMMIT} (testnet)`);
    const down = stampFetch([tx]);
    down.down = true;
    vi.stubGlobal('fetch', down.fetchImpl);
    render(<BeadScreen id={BEAD} />);
    const section = await screen.findByRole('region', { name: 'Stamp' });
    await waitFor(() => expect(within(section).getByText('Could not reach WhatsOnChain')).toBeInTheDocument());
    cleanup();
    vi.stubGlobal('fetch', stampFetch([tx]).fetchImpl);
    render(<BeadScreen id={BEAD} />);
    expect(await screen.findByText('In the mempool, no block yet')).toBeInTheDocument();
  });

  it('asks him to unlock when there is no key, with what was checked so far', async () => {
    const tx = stampTransaction({ senderHex: '22'.repeat(32), recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig: rigOfBead(), commit: COMMIT });
    await storeBead(`STAMP ${tx.txid} for ${COMMIT} (testnet)`);
    lock();
    vi.stubGlobal('fetch', stampFetch([tx], 1_790_000_100).fetchImpl);
    render(<BeadScreen id={BEAD} />);
    expect(await screen.findByText(/Unlock your key to open the sealed part/)).toBeInTheDocument();
    expect(screen.getByText(/The commitment on chain matches this commit/)).toBeInTheDocument();
  });
});
