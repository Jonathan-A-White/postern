// Issuing three licences in a row, then reading the Issued licences, against a WhatsOnChain that
// refuses what the free tier refuses (mw-i7cwnn): two requests starting under 350 ms apart, or
// more than 3 in a second. The 429 carries no CORS header, so the phone sees a failed fetch. The
// whole path is the real one (the Issue button, issueLicence, the mint builder's reads of the
// coins' source transactions, the list); only the mint builder's contract is the fake one.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import { IssueLicences } from '../../src/key/IssueLicences';
import { CHAIN_READ_GAP_MS, resetChainPacer, setChainReadGapMs } from '../../src/services/chainPacer';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
import { HOLDERS, ISSUER_MASTER, serveBackendAndWhatsOnChain } from '../support/issue-burst';

vi.mock('spell-forge-bsv', async (importOriginal) => (await import('../support/mint-builder-mock')).mintBuilderMock(importOriginal));

afterAll(() => cleanup());

describe('issuing three licences in a row against a rate-limited WhatsOnChain', () => {
  beforeEach(async () => {
    await db.pendingSpends.clear();
    await db.settings.clear();
    resetSharedChainReads();
    resetChainPacer();
    setChainReadGapMs(CHAIN_READ_GAP_MS);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setChainReadGapMs(0);
  });

  it('shows the three licences, with no "could not be read" error', { timeout: 90_000 }, async () => {
    const { broadcast } = await serveBackendAndWhatsOnChain();
    render(<IssueLicences issuerKey={ISSUER_MASTER} />);
    const issueSection = await screen.findByRole('region', { name: 'Issue a licence' });
    for (const [n, holder] of HOLDERS.entries()) {
      await userEvent.type(within(issueSection).getByLabelText("Holder's public key"), holder);
      await userEvent.click(within(issueSection).getByRole('button', { name: 'Issue' }));
      await userEvent.click(await within(issueSection).findByRole('button', { name: 'Confirm issue' }));
      await waitFor(() => expect(broadcast).toHaveLength(n + 1), { timeout: 30_000 });
      await within(issueSection).findByRole('button', { name: 'Issue' });
    }

    const listed = screen.getByRole('region', { name: 'Issued licences' });
    await waitFor(
      () => {
        expect(within(listed).queryByText(/could not be read/)).toBeNull();
        const rows = within(listed).getAllByTestId('issued-row');
        expect(rows).toHaveLength(3);
        for (const row of rows) expect(row).toHaveTextContent('held');
      },
      { timeout: 60_000, interval: 250 },
    );
    expect(within(listed).queryByText(/could not be read/)).toBeNull();
  });

  it('keeps the licence just issued on screen, and reads again by itself, when the list cannot be read for a while', { timeout: 60_000 }, async () => {
    const { broadcast } = await serveBackendAndWhatsOnChain({
      hexRefusedFor: (txid, woc) => {
        woc.failingHex.add(txid);
        setTimeout(() => woc.failingHex.delete(txid), 3000);
      },
    });
    let errorSeen = false;
    const watch = setInterval(() => {
      if (document.body.textContent?.includes('could not be read')) errorSeen = true;
    }, 50);
    try {
      render(<IssueLicences issuerKey={ISSUER_MASTER} />);
      const issueSection = await screen.findByRole('region', { name: 'Issue a licence' });
      await userEvent.type(within(issueSection).getByLabelText("Holder's public key"), HOLDERS[0]);
      await userEvent.click(within(issueSection).getByRole('button', { name: 'Issue' }));
      await userEvent.click(await within(issueSection).findByRole('button', { name: 'Confirm issue' }));
      await waitFor(() => expect(broadcast).toHaveLength(1), { timeout: 30_000 });

      const listed = screen.getByRole('region', { name: 'Issued licences' });
      await waitFor(() => expect(within(listed).getByTestId('issued-row')).toHaveTextContent('pending'), { timeout: 30_000 });
      await waitFor(() => expect(within(listed).getByTestId('issued-row')).toHaveTextContent('held'), { timeout: 30_000, interval: 250 });
      expect(errorSeen).toBe(false);
    } finally {
      clearInterval(watch);
    }
  });
});
