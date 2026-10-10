// features/steps/issue-busy.steps.tsx — runs features/issue-busy.feature (mw-rch8bu): the real Key screen's
// Issue, over a backend that relays WhatsOnChain's 429 page as its 502 (tests/support/issue-burst.ts).
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
import { HOLDERS, ISSUER_MASTER, WOC_429_ERROR, serveBackendAndWhatsOnChain, type BackendRefusal } from '../../tests/support/issue-burst';

vi.mock('spell-forge-bsv', async (importOriginal) => (await import('../../tests/support/mint-builder-mock')).mintBuilderMock(importOriginal));

const feature = await loadFeature('features/issue-busy.feature');

const RATE_LIMITED = 'WhatsOnChain is rate-limiting us. Nothing was spent. Try again in a minute.';
const BUSY = 'WhatsOnChain is busy, trying again…';
const UNBROKEN = 'x'.repeat(200);

let server: Awaited<ReturnType<typeof serveBackendAndWhatsOnChain>>;
let refusal: ((route: 'utxos' | 'broadcast', call: number) => BackendRefusal | undefined) | undefined;
let warned: MockInstance;
let busySeen: boolean;
// The screen reads the balance from the same coin list when it opens; only the calls Issue makes are counted and refused.
let issuing: boolean;
let issueCalls: { utxos: number; broadcast: number };
let coinListsBeforeBroadcast = 0;
let watch: ReturnType<typeof setInterval> | undefined;

async function openKeyScreen(): Promise<void> {
  issuing = false;
  issueCalls = { utxos: 0, broadcast: 0 };
  server = await serveBackendAndWhatsOnChain({
    backendRefuses: (route) => {
      if (!issuing) return undefined;
      issueCalls[route]++;
      if (route === 'broadcast' && issueCalls.broadcast === 1) coinListsBeforeBroadcast = issueCalls.utxos;
      return refusal?.(route, issueCalls[route]);
    },
  });
  watch = setInterval(() => {
    if (document.body.textContent?.includes(BUSY)) busySeen = true;
  }, 5);
  render(<IssueLicences issuerKey={ISSUER_MASTER} />);
  await screen.findByRole('region', { name: 'Issue a licence' });
  await waitFor(() => expect(screen.getByTestId('issue-cost')).toHaveTextContent(/Balance: /));
}

async function issueToOneKey(): Promise<void> {
  issuing = true;
  const section = screen.getByRole('region', { name: 'Issue a licence' });
  await userEvent.type(within(section).getByLabelText("Holder's public key"), HOLDERS[0]);
  await userEvent.click(within(section).getByRole('button', { name: 'Issue' }));
  await userEvent.click(await within(section).findByRole('button', { name: 'Confirm issue' }));
}

const issueSection = () => screen.getByRole('region', { name: 'Issue a licence' });

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

  Scenario('mw-rch8bu AC-1: a 429 on the coin list is tried again, the screen says so, and the licence is issued', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page twice when it lists the coins", () => {
      refusal = (route, call) => (route === 'utxos' && call <= 2 ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', issueToOneKey);
    Then('the screen says WhatsOnChain is busy and it is trying again', async () => {
      await waitFor(() => expect(busySeen).toBe(true), { timeout: 20_000 });
    });
    And('the licence is issued on the third try', async () => {
      await waitFor(() => expect(server.broadcast).toHaveLength(1), { timeout: 20_000 });
      expect(coinListsBeforeBroadcast).toBe(3);
    });
    And('the screen shows no error', async () => {
      await within(issueSection()).findByText(/^Issued:/, {}, { timeout: 20_000 });
      expect(within(issueSection()).queryByRole('alert')).toBeNull();
    });
  });

  Scenario('mw-rch8bu AC-2: a 429 that does not clear ends in one plain line, with no page and nothing spent', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page every time it lists the coins", () => {
      refusal = (route) => (route === 'utxos' ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', issueToOneKey);
    Then('the screen says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute', async () => {
      expect(await within(issueSection()).findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent(RATE_LIMITED);
    });
    And('the coins were asked for four times', () => {
      expect(issueCalls.utxos).toBe(4);
    });
    And("the screen shows none of WhatsOnChain's page", () => {
      expect(document.body.textContent).not.toMatch(/<html|nginx|Too Many Requests/);
    });
    And('the page went to the console', () => {
      expect(warned.mock.calls.flat().join(' ')).toContain('429 Too Many Requests');
    });
  });

  Scenario('mw-rch8bu AC-3: a 429 on the broadcast is sent again, and when it does not clear nothing was spent', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 429 page every time it broadcasts", () => {
      refusal = (route) => (route === 'broadcast' ? WOC_429_ERROR : undefined);
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', issueToOneKey);
    Then('the screen says WhatsOnChain is rate-limiting us, nothing was spent, try again in a minute', async () => {
      expect(await within(issueSection()).findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent(RATE_LIMITED);
    });
    And('the broadcast was tried four times', () => {
      expect(issueCalls.broadcast).toBe(4);
    });
  });

  Scenario('mw-rch8bu AC-4: a 503 on the broadcast is not sent again, and the screen says it may have gone out and how to check', ({ Given, When, Then, And }) => {
    Given("the backend relays WhatsOnChain's 503 when it broadcasts", () => {
      refusal = (route) => (route === 'broadcast' ? { status: 502, error: 'WhatsOnChain said 503: <html>Service Unavailable</html>' } : undefined);
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', issueToOneKey);
    Then('the screen says the licence may have gone out and to check Issued licences before issuing again', async () => {
      const alert = await within(issueSection()).findByRole('alert', {}, { timeout: 20_000 });
      expect(alert).toHaveTextContent(/may have gone out/);
      expect(alert).toHaveTextContent(/Issued licences/);
      expect(alert).not.toHaveTextContent(/Nothing was spent/);
      expect(document.body.textContent).not.toMatch(/<html/);
    });
    And('the broadcast was tried once', () => {
      expect(issueCalls.broadcast).toBe(1);
    });
  });

  Scenario('mw-rch8bu AC-5: a long unbroken error wraps instead of running off the screen', ({ Given, When, Then, And }) => {
    Given('the backend answers a coin list refusal of 200 unbroken characters', () => {
      refusal = (route) => (route === 'utxos' ? { status: 502, error: UNBROKEN } : undefined);
    });
    And('the Key screen of an issuer is open', openKeyScreen);
    When('I issue a licence to one key', issueToOneKey);
    Then('the error wraps anywhere', async () => {
      const alert = await within(issueSection()).findByRole('alert', {}, { timeout: 20_000 });
      expect(alert).toHaveTextContent(UNBROKEN);
      expect(alert.className).toContain('[overflow-wrap:anywhere]');
    });
  });
});
