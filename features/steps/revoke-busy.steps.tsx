// features/steps/revoke-busy.steps.tsx — runs features/revoke-busy.feature (mw-2f65hu): the real Key screen's
// Revoke on an Issued row, over a backend that relays WhatsOnChain's 429 page as its 502 (tests/support/issue-burst.ts).
// See gate.steps.tsx for why dont-cleanup-after-each is imported and cleanup() called by hand.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi, type MockInstance } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { db } from '../../src/data/db';
import { IssueLicences } from '../../src/key/IssueLicences';
import { setBusyRetryDelaysMs } from '../../src/services/chainBusy';
import { resetChainPacer, setChainReadGapMs } from '../../src/services/chainPacer';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
import { ISSUER_MASTER, WOC_429_ERROR, serveBackendAndWhatsOnChain, type BackendRefusal } from '../../tests/support/issue-burst';

vi.mock('spell-forge-bsv', async (importOriginal) => (await import('../../tests/support/mint-builder-mock')).mintBuilderMock(importOriginal));

const feature = await loadFeature('features/revoke-busy.feature');

const RATE_LIMITED = 'WhatsOnChain is rate-limiting us. Nothing was spent. Try again in a minute.';
const BUSY = 'WhatsOnChain is busy, trying again…';

let server: Awaited<ReturnType<typeof serveBackendAndWhatsOnChain>>;
let refusal: ((route: 'utxos' | 'broadcast', call: number) => BackendRefusal | undefined) | undefined;
let warned: MockInstance;
let busySeen: boolean;
// The screen reads the balance from the same coin list when it opens; only the calls Revoke makes are counted and refused.
let revoking: boolean;
let revokeCalls: { utxos: number; broadcast: number };
let coinListsBeforeBroadcast = 0;
let watch: ReturnType<typeof setInterval> | undefined;

async function openKeyScreen(): Promise<void> {
  revoking = false;
  revokeCalls = { utxos: 0, broadcast: 0 };
  server = await serveBackendAndWhatsOnChain({
    issuedMint: true,
    wocRateLimit: false,
    backendRefuses: (route) => {
      if (!revoking) return undefined;
      revokeCalls[route]++;
      if (route === 'broadcast' && revokeCalls.broadcast === 1) coinListsBeforeBroadcast = revokeCalls.utxos;
      return refusal?.(route, revokeCalls[route]);
    },
  });
  watch = setInterval(() => {
    if (document.body.textContent?.includes(BUSY)) busySeen = true;
  }, 5);
  render(<IssueLicences issuerKey={ISSUER_MASTER} />);
  await screen.findByRole('region', { name: 'Issued licences' });
  await waitFor(() => expect(screen.getByTestId('issue-cost')).toHaveTextContent(/Balance: /));
  await screen.findAllByTestId('issued-row', {}, { timeout: 20_000 });
}

async function revokeTheLicence(): Promise<void> {
  const row = within(screen.getAllByTestId('issued-row')[0]);
  await userEvent.click(row.getByRole('button', { name: 'Revoke' }));
  revoking = true;
  await userEvent.click(await row.findByRole('button', { name: 'Confirm revoke' }));
}

const theRow = () => within(screen.getAllByTestId('issued-row')[0]);

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
    setChainReadGapMs(0);
    setBusyRetryDelaysMs([30, 30, 30]);
    refusal = undefined;
    busySeen = false;
    warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  AfterEachScenario(() => {
    cleanup();
    clearInterval(watch);
    vi.unstubAllGlobals();
    warned.mockRestore();
    setBusyRetryDelaysMs(undefined);
  });

  Scenario('mw-2f65hu AC-1: a 429 on the coin list is tried again, the row says so, and the licence ends revoked', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page twice when it lists the coins", () => {
      refusal = (route, call) => (route === 'utxos' && call <= 2 ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer with one held licence is open', openKeyScreen);
    When('I revoke that licence', revokeTheLicence);
    Then('the row says WhatsOnChain is busy and it is trying again', async () => {
      await waitFor(() => expect(busySeen).toBe(true), { timeout: 20_000 });
    });
    And('the revoke is broadcast on the third try', async () => {
      await waitFor(() => expect(server.broadcast).toHaveLength(1), { timeout: 20_000 });
      expect(coinListsBeforeBroadcast).toBe(3);
    });
    And('the licence is shown revoked', async () => {
      await waitFor(() => expect(screen.getAllByTestId('issued-row')[0]).toHaveTextContent('revoked'), { timeout: 20_000 });
      expect(theRow().queryByRole('alert')).toBeNull();
    });
  });

  Scenario('mw-2f65hu AC-1: a 429 on the broadcast is sent again and the licence ends revoked', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page twice when it broadcasts", () => {
      refusal = (route, call) => (route === 'broadcast' && call <= 2 ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer with one held licence is open', openKeyScreen);
    When('I revoke that licence', revokeTheLicence);
    Then('the row says WhatsOnChain is busy and it is trying again', async () => {
      await waitFor(() => expect(busySeen).toBe(true), { timeout: 20_000 });
    });
    And('the licence is shown revoked', async () => {
      await waitFor(() => expect(screen.getAllByTestId('issued-row')[0]).toHaveTextContent('revoked'), { timeout: 20_000 });
      expect(theRow().queryByRole('alert')).toBeNull();
    });
    And('the broadcast was tried three times', () => {
      expect(revokeCalls.broadcast).toBe(3);
      expect(server.broadcast).toHaveLength(1);
    });
  });

  Scenario('mw-2f65hu AC-2: a 429 on the coin list that does not clear ends in one plain line, with nothing spent', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page every time it lists the coins", () => {
      refusal = (route) => (route === 'utxos' ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer with one held licence is open', openKeyScreen);
    When('I revoke that licence', revokeTheLicence);
    Then('the row says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute', async () => {
      expect(await theRow().findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent(RATE_LIMITED);
    });
    And('the coins were asked for four times', () => {
      expect(revokeCalls.utxos).toBe(4);
    });
    And('the screen shows none of WhatsOnChain\'s page and no "said 429"', () => {
      expect(document.body.textContent).not.toMatch(/<html|nginx|Too Many Requests|said 429/);
    });
    And('nothing was broadcast', () => {
      expect(server.broadcast).toHaveLength(0);
    });
  });

  Scenario('mw-2f65hu AC-2: a 429 on the broadcast that does not clear says nothing was spent', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page every time it broadcasts", () => {
      refusal = (route) => (route === 'broadcast' ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer with one held licence is open', openKeyScreen);
    When('I revoke that licence', revokeTheLicence);
    Then('the row says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute', async () => {
      expect(await theRow().findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent(RATE_LIMITED);
    });
    And('the broadcast was tried four times', () => {
      expect(revokeCalls.broadcast).toBe(4);
    });
    And('the screen shows none of WhatsOnChain\'s page and no "said 429"', () => {
      expect(document.body.textContent).not.toMatch(/<html|nginx|Too Many Requests|said 429/);
    });
    And('the row keeps Confirm revoke', () => {
      expect(theRow().getByRole('button', { name: 'Confirm revoke' })).toBeEnabled();
    });
  });

  Scenario('mw-2f65hu AC-2: a 503 on the broadcast is not sent again, and the row says the revoke may have gone out', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 503 when it broadcasts", () => {
      refusal = (route) => (route === 'broadcast' ? { status: 502, error: 'WhatsOnChain said 503: <html>Service Unavailable</html>' } : undefined);
    });
    And('the Key screen of an issuer with one held licence is open', openKeyScreen);
    When('I revoke that licence', revokeTheLicence);
    Then('the row says the revoke may have gone out and to check its status before revoking it again', async () => {
      const alert = await theRow().findByRole('alert', {}, { timeout: 20_000 });
      expect(alert).toHaveTextContent(/may have gone out/);
      expect(alert).toHaveTextContent(/before you revoke it again/);
      expect(alert).not.toHaveTextContent(/Nothing was spent/);
      expect(document.body.textContent).not.toMatch(/<html/);
    });
    And('the broadcast was tried once', () => {
      expect(revokeCalls.broadcast).toBe(1);
    });
  });
});
