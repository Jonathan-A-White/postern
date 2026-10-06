// The screens reach the chain through src/chain.ts (mw-e6e8f2.3): a chain with no Stamp section leaves the
// bead page without one, and the Key screen shows what a plugged-in chain answers, asking no WhatsOnChain host.
import '@testing-library/react/dont-cleanup-after-each';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Utils } from '@bsv/sdk';
import { chain, setChain, type Chain } from '../../src/chain';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { KeyVault } from '../../src/key';
import { db } from '../../src/data/db';
import { beadDetailsRepo, vaultRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { fixtureDetail, fixtureView } from '../support/cockpit-fixture';
import { stampFetch } from '../support/stamp-fetch';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const BEAD = 'mw-f758y.31.2';
const KEY_HEX = '11'.repeat(32);
const COMMIT = '1fc03343fca689a0c83e2d5019463b332b401ab6';
const TXID = 'ab'.repeat(32);

let restore: Chain | undefined;

beforeEach(async () => {
  await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear(), db.vault.clear()]);
  setKey(new Uint8Array(Utils.toArray(KEY_HEX, 'hex')));
});
afterEach(() => {
  cleanup();
  lock();
  if (restore) setChain(restore);
  restore = undefined;
  vi.unstubAllGlobals();
});
afterAll(() => cleanup());

describe('the bead page with a chain that has no Stamp section', () => {
  it('shows no Stamp heading, and throws nothing, though the bead has a STAMP comment', async () => {
    const view = fixtureView();
    await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
    const detail = fixtureDetail(BEAD);
    if (!detail) throw new Error('fixture bead missing');
    detail.comments.push({ at: '2026-10-05T10:00:00Z', author: 'mw@laptop', text: `STAMP ${TXID} for ${COMMIT} (testnet)` });
    await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
    const fetched = stampFetch([]);
    vi.stubGlobal('fetch', fetched.fetchImpl);
    restore = setChain({ ...chain, screens: {} });

    render(<BeadScreen id={BEAD} />);

    await screen.findByText('Priority');
    expect(screen.queryByText('Stamp')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Stamp' })).toBeNull();
    expect(fetched.calls).toEqual([]);
  });
});

describe('the Key screen with a chain that answers fixed values', () => {
  it('shows its balance and licence, and asks no WhatsOnChain host', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(String(input));
        throw new TypeError('Failed to fetch');
      }),
    );
    restore = setChain({
      ...chain,
      balance: vi.fn(async () => 424_242),
      cachedLicenceStatus: vi.fn(async () => ({ held: true as const, outpoint: { txid: 'c'.repeat(64), vout: 0 }, collection: 'postern', checkedAt: '2026-10-06T00:00:00Z' })),
      checkLicence: vi.fn(async () => {
        throw new Error('not asked');
      }),
    } as Chain);
    // a vault row, and the key already unlocked in the session, so the screen opens unlocked
    await vaultRepo.save({ mode: 'phrase', ciphertext: new ArrayBuffer(1), iv: new Uint8Array(12), publicKeyHex: '02' + '11'.repeat(32) });

    render(<KeyVault />);

    expect(await screen.findByText('Balance: 424242 sats')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Minted:/)).toBeInTheDocument());
    expect(screen.getByText('c'.repeat(64))).toBeInTheDocument();
    expect(requested.filter((url) => url.includes('whatsonchain'))).toEqual([]);
  });
});
