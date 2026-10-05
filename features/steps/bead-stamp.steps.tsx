// features/steps/bead-stamp.steps.tsx — runs features/bead-stamp.feature (mw-zuju64.1): the bead page's Stamp
// section reads the chain stamp a landing left and says whether it checks out.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Utils } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { beadDetailsRepo, viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stampLimiter } from '../../src/services/stamp';
import { fixtureDetail, fixtureView } from '../../tests/support/cockpit-fixture';
import { publicKeyOf, stampTransaction, type ChainRecord } from '../../tests/support/chain-record';
import { stampFetch } from '../../tests/support/stamp-fetch';

vi.mock('../../src/services/beads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/beads')>()),
  fetchBeadDetail: vi.fn(async () => ({ status: 'ok' as const })),
}));

const BEAD = 'mw-f758y.31.2';
const GOVERNOR = '11'.repeat(32);
const COMMIT = '1fc03343fca689a0c83e2d5019463b332b401ab6';

async function stampedBead(chainCommit: string): Promise<void> {
  const view = fixtureView();
  const rig = view.beads.find((b) => b.id === BEAD)?.path?.rig;
  if (!rig) throw new Error('fixture bead has no rig');
  const tx: ChainRecord = stampTransaction({ senderHex: '22'.repeat(32), recipientPublicKeyHex: publicKeyOf(GOVERNOR), rig, commit: chainCommit });
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: Date.now() });
  const detail = fixtureDetail(BEAD);
  if (!detail) throw new Error('fixture bead missing');
  detail.comments.push({ at: '2026-10-05T10:00:00Z', author: 'mw@laptop', text: `STAMP ${tx.txid} for ${COMMIT} (testnet)` });
  await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: Date.now() });
  vi.stubGlobal('fetch', stampFetch([tx], 1_790_000_100).fetchImpl);
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/bead-stamp.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    stampLimiter.gapMs = 0;
    await Promise.all([db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear(), db.settings.clear()]);
    setKey(new Uint8Array(Utils.toArray(GOVERNOR, 'hex')));
  });

  const section = () => screen.findByRole('region', { name: 'Stamp' });

  Scenario('mw-zuju64.1: a stamp whose commitment and sealed body match this commit checks out', ({ Given, When, Then, And }) => {
    Given('a bead whose comment says it was stamped for a commit of its rig, and the chain holds that stamp', () => stampedBead(COMMIT));
    When('he opens the bead page', () => {
      render(<BeadScreen id={BEAD} />);
    });
    Then('the Stamp section shows {string}', async (_c, text: string) => {
      const found = await section();
      await waitFor(() => expect(within(found).getByText(text)).toBeInTheDocument());
    });
    And('the Stamp section links to the transaction on the chain', async () => {
      const found = await section();
      expect(within(found).getByRole('link', { name: /View on chain/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/test\.whatsonchain\.com\/tx\/[0-9a-f]{64}$/));
    });
  });

  Scenario('mw-zuju64.1: a stamp made for a different commit says the commitment does not match', ({ Given, When, Then, And }) => {
    Given('a bead whose comment says it was stamped for a commit, but the chain\'s stamp was made for another', () => stampedBead(COMMIT.slice(0, -1) + '7'));
    When('he opens the bead page', () => {
      render(<BeadScreen id={BEAD} />);
    });
    Then('the Stamp section shows {string}', async (_c, text: string) => {
      const found = await section();
      await waitFor(() => expect(within(found).getByText(text)).toBeInTheDocument());
    });
    And('the Stamp section does not show {string}', async (_c, text: string) => {
      const found = await section();
      expect(within(found).queryByText(text)).toBeNull();
    });
  });
});
