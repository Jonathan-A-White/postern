// features/steps/issue-burst.steps.tsx — runs features/issue-burst.feature (mw-i7cwnn): the real Key screen's
// Issue and Issued licences, over the backend and a rate-limited WhatsOnChain double (tests/support/issue-burst.ts).
// See gate.steps.tsx for why dont-cleanup-after-each is imported and cleanup() called by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db } from '../../src/data/db';
import { IssueLicences } from '../../src/key/IssueLicences';
import { CHAIN_READ_GAP_MS, resetChainPacer, setChainReadGapMs } from '../../src/services/chainPacer';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
import { HOLDERS, ISSUER_MASTER, serveBackendAndWhatsOnChain } from '../../tests/support/issue-burst';

vi.mock('spell-forge-bsv', async (importOriginal) => (await import('../../tests/support/mint-builder-mock')).mintBuilderMock(importOriginal));

// Each step is its own test and a licence takes seconds to issue and list at 350 ms a request.
vi.setConfig({ testTimeout: 90_000 });

const feature = await loadFeature('features/issue-burst.feature');

let broadcast: string[];
let errorSeen: boolean;
let watch: ReturnType<typeof setInterval> | undefined;
let hexRefused = false;

async function openKeyScreen(): Promise<void> {
  ({ broadcast } = await serveBackendAndWhatsOnChain(
    hexRefused
      ? {
          hexRefusedFor: (txid, woc) => {
            woc.failingHex.add(txid);
            setTimeout(() => woc.failingHex.delete(txid), 3000);
          },
        }
      : {},
  ));
  watch = setInterval(() => {
    if (document.body.textContent?.includes('could not be read')) errorSeen = true;
  }, 50);
  render(<IssueLicences issuerKey={ISSUER_MASTER} />);
  await screen.findByRole('region', { name: 'Issue a licence' });
}

async function issueTo(holder: string, count: number): Promise<void> {
  const section = screen.getByRole('region', { name: 'Issue a licence' });
  await userEvent.type(within(section).getByLabelText("Holder's public key"), holder);
  await userEvent.click(within(section).getByRole('button', { name: 'Issue' }));
  await userEvent.click(await within(section).findByRole('button', { name: 'Confirm issue' }));
  await waitFor(() => expect(broadcast).toHaveLength(count), { timeout: 30_000 });
  await within(section).findByRole('button', { name: 'Issue' });
}

const listed = () => screen.getByRole('region', { name: 'Issued licences' });

afterAll(() => {
  cleanup();
  clearInterval(watch);
});

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    await db.pendingSpends.clear();
    await db.settings.clear();
    resetSharedChainReads();
    resetChainPacer();
    setChainReadGapMs(CHAIN_READ_GAP_MS);
    errorSeen = false;
    hexRefused = false;
  });
  AfterEachScenario(() => {
    cleanup();
    clearInterval(watch);
    vi.unstubAllGlobals();
    setChainReadGapMs(0);
  });

  Scenario('mw-i7cwnn AC-1: three licences issued in a row are listed, with no read error', ({ Given, When, Then, And }) => {
    Given('WhatsOnChain refuses requests that start under 350 ms apart or more than 3 in a second', () => undefined);
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue licences to three keys in a row', async () => {
      for (const [n, holder] of HOLDERS.entries()) await issueTo(holder, n + 1);
    });
    Then('the Issued licences section lists the three licences', async () => {
      await waitFor(
        () => {
          const rows = within(listed()).getAllByTestId('issued-row');
          expect(rows).toHaveLength(3);
          for (const row of rows) expect(row).toHaveTextContent('held');
        },
        { timeout: 50_000, interval: 250 },
      );
    });
    And('it does not say the licences could not be read', () => {
      expect(errorSeen).toBe(false);
      expect(within(listed()).queryByText(/could not be read/)).toBeNull();
    });
  });

  Scenario('mw-i7cwnn AC-2: a list that cannot be read for a while keeps the licence just issued and reads again by itself', ({ Given, When, Then, And }) => {
    Given('WhatsOnChain cannot give the new transaction for three seconds', () => {
      hexRefused = true;
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', () => issueTo(HOLDERS[0], 1));
    Then('the new licence shows in the Issued licences section as pending', async () => {
      await waitFor(() => expect(within(listed()).getByTestId('issued-row')).toHaveTextContent('pending'), { timeout: 30_000 });
    });
    And('it shows as held once the list is read again', async () => {
      await waitFor(() => expect(within(listed()).getByTestId('issued-row')).toHaveTextContent('held'), { timeout: 30_000, interval: 250 });
    });
    And('no error about the licences not being read was shown', () => {
      expect(errorSeen).toBe(false);
    });
  });
});
