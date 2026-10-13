// features/steps/issue-balance.steps.tsx — runs features/issue-balance.feature (mw-swrev1): the issue form's
// balance line, over a stubbed chain door. Only setTimeout is faked, and IndexedDB is settled on setImmediate;
// the real clock comes back after each scenario (never in a step: each step is its own test).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, expect, vi, type Mock } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { chain, setChain, type Chain } from '../../src/chain';
import { IssueLicences } from '../../src/key/IssueLicences';
import { HOLDERS, ISSUER_MASTER } from '../../tests/support/issue-burst';

vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', collections: [{ name: 'legend', app: '' }] })),
}));

const feature = await loadFeature('features/issue-balance.feature');

let restore: Chain | undefined;
let issuerBalance: Mock<Chain['issuerBalance']>;

const settle = async () => {
  for (let n = 0; n < 20; n += 1) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
};
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const costLine = () => screen.getByTestId('issue-cost');

function stub(balance: Mock<Chain['issuerBalance']>) {
  issuerBalance = balance;
  restore = setChain({
    ...chain,
    issuerBalance: balance,
    issuedLicences: vi.fn(async () => []),
    issueLicence: vi.fn(async () => ({ txid: 'ab'.repeat(32), origin: `${'ab'.repeat(32)}:0`, holder: HOLDERS[0], collection: 'legend' })),
  });
}

async function openForm() {
  render(<IssueLicences issuerKey={ISSUER_MASTER} />);
  await pass(0);
}

afterAll(() => cleanup());

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  BeforeEachScenario(() => {
    cleanup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  AfterEachScenario(() => {
    cleanup();
    vi.useRealTimers();
    if (restore) setChain(restore);
    restore = undefined;
  });

  Scenario('mw-swrev1 AC-1: a refused balance read shows the reason, as the Key screen does', ({ Given, When, Then }) => {
    Given('the chain refuses the issuer\'s balance with "the node is out to lunch"', () => {
      stub(vi.fn<Chain['issuerBalance']>().mockRejectedValue(new Error('the node is out to lunch')));
    });
    When('the issue form opens', openForm);
    Then('the cost line reads "Balance unavailable (WhatsOnChain): the node is out to lunch"', () => {
      expect(costLine()).toHaveTextContent('Balance unavailable (WhatsOnChain): the node is out to lunch');
    });
  });

  Scenario('mw-swrev1 AC-2: a refused balance read is tried again with growing waits, and a later success shows the balance', ({ Given, When, Then, And }) => {
    Given("the chain refuses the issuer's balance twice and then answers 12345 sats", () => {
      stub(vi.fn<Chain['issuerBalance']>().mockRejectedValueOnce(new Error('429')).mockRejectedValueOnce(new Error('429')).mockResolvedValue(12_345));
    });
    When('the issue form opens and time passes', async () => {
      await openForm();
      for (let n = 0; n < 4; n += 1) await pass(10_000);
    });
    Then('the cost line reads "Balance: 12,345 sats."', () => {
      expect(costLine()).toHaveTextContent('Balance: 12,345 sats.');
    });
    And('the balance was read three times', () => {
      expect(issuerBalance).toHaveBeenCalledTimes(3);
    });
  });

  Scenario('mw-swrev1 AC-3: after a successful Issue the balance is read again', ({ Given, When, Then }) => {
    Given('the chain answers 50000 sats and then 48000 sats', () => {
      stub(vi.fn<Chain['issuerBalance']>().mockResolvedValueOnce(50_000).mockResolvedValue(48_000));
    });
    When('the issue form opens and a licence is issued', async () => {
      await openForm();
      const form = screen.getByRole('region', { name: 'Issue a licence' });
      fireEvent.change(within(form).getByLabelText("Holder's public key"), { target: { value: HOLDERS[0] } });
      fireEvent.click(within(form).getByRole('button', { name: 'Issue' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Confirm issue' }));
      await settle();
      await pass(100);
    });
    Then('the cost line reads "Balance: 48,000 sats."', () => {
      expect(costLine()).toHaveTextContent('Balance: 48,000 sats.');
    });
  });
});
