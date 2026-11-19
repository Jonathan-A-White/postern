// features/steps/issue-billing.steps.tsx — runs features/issue-billing.feature (mw-cvwm1u.22): the Key
// screen's 'API only' switch on each issued licence's holder, over a stubbed chain door and a backend that
// keeps the marks in memory (src/services/billing is mocked; its wire is tests/unit/billing-service.test.ts).
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { chain, setChain, type Chain } from '../../src/chain';
import { IssueLicences } from '../../src/key/IssueLicences';
import { ISSUER_MASTER } from '../../tests/support/issue-burst';

const backend = vi.hoisted(() => ({
  marks: new Set<string>(),
  readFails: false,
  saveRefusal: '' as string,
  saved: [] as { holder: string; apiOnly: boolean }[],
}));

vi.mock('../../src/services/billing', () => ({
  readApiOnly: vi.fn(async () => {
    if (backend.readFails) throw new Error('The backend answered 500.');
    return new Set(backend.marks);
  }),
  setApiOnly: vi.fn(async (_key: Uint8Array, holder: string, apiOnly: boolean) => {
    if (backend.saveRefusal) throw new Error(backend.saveRefusal);
    backend.saved.push({ holder, apiOnly });
    if (apiOnly) backend.marks.add(holder);
    else backend.marks.delete(holder);
  }),
}));

vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn(async () => ({ pubkey: '', collections: [{ name: 'legend', app: '' }] })),
}));

const feature = await loadFeature('features/issue-billing.feature');

const HOLDERS = ['mHolderOneAddress11111111111111111', 'mHolderTwoAddress22222222222222222'];
let restore: Chain | undefined;

const settle = async () => {
  for (let n = 0; n < 20; n += 1) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
};

async function openKeyScreen() {
  cleanup();
  restore ??= setChain({
    ...chain,
    issuerBalance: vi.fn(async () => 50_000),
    issuedLicences: vi.fn(async () =>
      HOLDERS.map((holder, n) => ({ txid: `${n}`.repeat(64), origin: `${n}`.repeat(64) + ':0', collection: 'legend', holder, height: 100 + n, revoked: false })),
    ),
  });
  render(<IssueLicences issuerKey={ISSUER_MASTER} />);
  await settle();
}

const row = (n: number) => screen.getAllByTestId('issued-row')[n];
const toggle = (n: number) => within(row(n)).getByRole('switch', { name: 'API only' }) as HTMLInputElement;

afterAll(() => cleanup());

describeFeature(feature, ({ BeforeEachScenario, AfterEachScenario, Scenario }) => {
  BeforeEachScenario(() => {
    cleanup();
    backend.marks.clear();
    backend.readFails = false;
    backend.saveRefusal = '';
    backend.saved = [];
  });
  AfterEachScenario(() => {
    cleanup();
    if (restore) setChain(restore);
    restore = undefined;
  });

  Scenario("mw-cvwm1u.22 AC-2: each issued licence's holder shows its billing, Max unless marked API only", ({ Given, When, Then, And }) => {
    Given('the backend bills one of two licence holders API only', () => {
      backend.marks.add(HOLDERS[1]);
    });
    When("the Key screen's Issued licences open", openKeyScreen);
    Then(`the first holder's "API only" switch is off and its billing reads "Billing: Max"`, () => {
      expect(toggle(0).checked).toBe(false);
      expect(within(row(0)).getByTestId('issued-billing')).toHaveTextContent('Billing: Max');
    });
    And(`the second holder's "API only" switch is on and its billing reads "Billing: API only"`, () => {
      expect(toggle(1).checked).toBe(true);
      expect(within(row(1)).getByTestId('issued-billing')).toHaveTextContent('Billing: API only');
    });
  });

  Scenario('mw-cvwm1u.22 AC-2: turning API only on is saved on the backend and kept across a reload', ({ Given, When, Then, And }) => {
    Given('the backend bills every licence holder Max', () => {
      backend.marks.clear();
    });
    When("the Key screen's Issued licences open", openKeyScreen);
    And(`I turn on the first holder's "API only" switch`, async () => {
      fireEvent.click(toggle(0));
      await settle();
    });
    Then('the backend was told to bill that holder api', () => {
      expect(backend.saved).toEqual([{ holder: HOLDERS[0], apiOnly: true }]);
    });
    And(`the first holder's "API only" switch is on`, () => {
      expect(toggle(0).checked).toBe(true);
    });
    When('the Key screen is opened again', openKeyScreen);
    Then(`the first holder's "API only" switch is on`, () => {
      expect(toggle(0).checked).toBe(true);
      expect(within(row(1)).getByRole('switch', { name: 'API only' })).not.toBeChecked();
    });
  });

  Scenario('mw-cvwm1u.22 AC-2: a refused save puts the switch back and says why', ({ Given, When, Then, And }) => {
    Given(`the backend refuses to save a billing mark with "only the Governor's key may mark a licence holder's billing"`, () => {
      backend.saveRefusal = "only the Governor's key may mark a licence holder's billing";
    });
    When("the Key screen's Issued licences open", openKeyScreen);
    And(`I turn on the first holder's "API only" switch`, async () => {
      fireEvent.click(toggle(0));
      await settle();
    });
    Then(`the first holder's "API only" switch is off`, () => {
      expect(toggle(0).checked).toBe(false);
    });
    And(`I am told "Could not save: only the Governor's key may mark a licence holder's billing"`, () => {
      expect(within(row(0)).getByRole('alert')).toHaveTextContent("Could not save: only the Governor's key may mark a licence holder's billing");
    });
  });

  Scenario('mw-cvwm1u.22 AC-2: when the marks cannot be read the switches are off the table and say so', ({ Given, When, Then, And }) => {
    Given('the backend cannot give the billing marks', () => {
      backend.readFails = true;
    });
    When("the Key screen's Issued licences open", openKeyScreen);
    Then('every "API only" switch is disabled', () => {
      expect(toggle(0)).toBeDisabled();
      expect(toggle(1)).toBeDisabled();
    });
    And('I am told "Billing is not loaded"', () => {
      expect(screen.getByText(/Billing is not loaded/)).toBeInTheDocument();
    });
  });
});
