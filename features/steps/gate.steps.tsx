// features/steps/gate.steps.tsx — Runs features/gate.feature under vitest via
// @amiceli/vitest-cucumber. Renders the same Gate component tests/unit/gate.test.tsx
// exercises directly, through testing-library, so the two suites cover the same
// behaviour from a spec-first and a unit-first angle.
//
// vitest-cucumber runs each Given/When/Then as its own vitest test(), so
// testing-library's default afterEach unmount would tear the render down between
// steps; dont-cleanup-after-each keeps the Given step's render alive for Then/And,
// and the explicit afterAll below unmounts it once the scenario finishes.
//
// spell-forge-bsv's createChainProvider() is replaced for this whole file with one
// returning `fakeProvider` — a FakeChainProvider with no network access, so every
// scenario controls exactly what the gate's licence check sees. Given steps swap it
// out (or flip it offline) before "the app is opened" renders the Gate.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { Gate } from '../../src/gate';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { setMintPending } from '../../src/services/licence';
import { mintCostSatoshis } from '../../src/services/mint';
import { FakeChainProvider } from '../../tests/support/fake-chain-provider';
import { mintRecordTxHex } from '../../tests/support/nftgate-fixtures';

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => fakeProvider };
});

const TEST_KEY = PrivateKey.fromHex('22'.repeat(32));
const TEST_PUBLIC_KEY_HEX = TEST_KEY.toPublicKey().toString();
const TEST_ADDRESS = TEST_KEY.toPublicKey().toAddress('testnet');

async function freshGate(): Promise<void> {
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  fakeProvider = new FakeChainProvider();
}

async function saveTestVault(): Promise<void> {
  await vaultRepo.save({
    mode: 'phrase',
    ciphertext: new Uint8Array([1]).buffer,
    iv: new Uint8Array(12),
    salt: new Uint8Array(16),
    prfFallbackReason: 'webauthn-unavailable',
    publicKeyHex: TEST_PUBLIC_KEY_HEX,
  });
}

const feature = await loadFeature('features/gate.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a visitor sees the locked gate', ({ Given, Then, And }) => {
    Given('the app is opened', async () => {
      await freshGate();
      render(<Gate />);
    });

    Then('the screen shows "The gate is locked"', () => {
      expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    });

    And('the app name "Postern" and the version from package.json', () => {
      expect(screen.getByText('Postern')).toBeInTheDocument();
      expect(screen.getByText(__APP_VERSION__, { exact: false })).toBeInTheDocument();
    });
  });

  Scenario('AC-2: no key offers a link to set one up', ({ Given, When, Then, And }) => {
    Given('no key has been set up', async () => {
      await freshGate();
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then('the screen shows "The gate is locked"', () => {
      expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    });

    And('a "Set up your key" link to the key screen is offered', async () => {
      const link = await screen.findByRole('link', { name: 'Set up your key' });
      expect(link).toHaveAttribute('href', '?screen=key');
    });
  });

  Scenario('AC-3: a key without a licence shows the address and no licence found', ({ Given, When, Then, And }) => {
    Given('a key exists with no licence on chain', async () => {
      await freshGate();
      await saveTestVault();
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then("the screen shows the key's testnet address", async () => {
      expect(await screen.findByText(`Testnet address: ${TEST_ADDRESS}`)).toBeInTheDocument();
    });

    And('the screen shows "No licence found"', () => {
      expect(screen.getByText('No licence found')).toBeInTheDocument();
    });

    And('a "Check again" action is offered', () => {
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    });
  });

  Scenario('AC-4: a key with a licence opens the gate', ({ Given, When, Then, And }) => {
    Given('a key exists holding a licence on chain', async () => {
      await freshGate();
      await saveTestVault();
      fakeProvider.addTransaction(
        TEST_ADDRESS,
        'a'.repeat(64),
        mintRecordTxHex(chainConfig.collectionId, TEST_ADDRESS),
      );
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then('the screen shows "Licensed"', async () => {
      expect(await screen.findByText('Licensed')).toBeInTheDocument();
    });

    And("the screen shows the key's testnet address", () => {
      expect(screen.getByText(`Testnet address: ${TEST_ADDRESS}`)).toBeInTheDocument();
    });
  });

  Scenario('AC-6: a key without a licence offers a way to mint one', ({ Given, When, Then }) => {
    Given('a key exists with no licence on chain', async () => {
      await freshGate();
      await saveTestVault();
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then('a "Mint a licence" link to the key screen is offered', async () => {
      const link = await screen.findByRole('link', { name: 'Mint a licence' });
      expect(link).toHaveAttribute('href', '?screen=key');
    });
  });

  Scenario('AC-5: a cached licensed answer opens the gate offline', ({ Given, And, When, Then }) => {
    Given('a key exists holding a licence on chain', async () => {
      await freshGate();
      await saveTestVault();
      fakeProvider.addTransaction(
        TEST_ADDRESS,
        'b'.repeat(64),
        mintRecordTxHex(chainConfig.collectionId, TEST_ADDRESS),
      );
    });

    And('the gate has already opened once and cached that answer', async () => {
      render(<Gate />);
      await screen.findByText('Licensed');
    });

    When('the chain goes offline', () => {
      fakeProvider.offline = true;
    });

    And('the app is opened again', () => {
      cleanup();
      render(<Gate />);
    });

    Then('the screen shows "Licensed"', async () => {
      await waitFor(() => expect(screen.getByText('Licensed')).toBeInTheDocument());
    });
  });

  Scenario('mw-1589l.24 AC1: Check again shows a checking state until the answer lands', ({ Given, And, When, Then }) => {
    let resolvePause: () => void = () => {};

    Given('a key exists with no licence on chain', async () => {
      await freshGate();
      await saveTestVault();
    });

    And('the app is opened', async () => {
      render(<Gate />);
      await screen.findByRole('button', { name: 'Check again' });
    });

    And('the chain is slow to answer', () => {
      fakeProvider.pauseUntil = new Promise((resolve) => {
        resolvePause = resolve;
      });
    });

    When('"Check again" is chosen', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    });

    Then('the button is disabled and shows "Checking..."', () => {
      expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();
    });

    When('the chain answers', () => {
      fakeProvider.pauseUntil = null;
      resolvePause();
    });

    Then('the button shows "Check again" again', async () => {
      expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled();
    });
  });

  Scenario('mw-1589l.24 AC2: a just-broadcast mint shows as pending, not "No licence found"', ({ Given, And, When, Then }) => {
    Given('a key exists with no licence on chain', async () => {
      await freshGate();
      await saveTestVault();
    });

    And('a licence mint has just been broadcast', async () => {
      await setMintPending('c'.repeat(64));
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then('the screen shows "Your licence mint is broadcast; the chain can take a minute to show it"', async () => {
      expect(
        await screen.findByText('Your licence mint is broadcast; the chain can take a minute to show it'),
      ).toBeInTheDocument();
    });

    And('the screen does not show "No licence found"', () => {
      expect(screen.queryByText('No licence found')).not.toBeInTheDocument();
    });
  });

  Scenario('mw-1589l.26 AC1: the no-licence state offers a collapsed "What is a licence?" explanation', ({ Given, When, Then }) => {
    Given('a key exists with no licence on chain', async () => {
      await freshGate();
      await saveTestVault();
    });

    When('the app is opened', () => {
      render(<Gate />);
    });

    Then('a "What is a licence?" control is offered, collapsed', async () => {
      const details = (await screen.findByText('What is a licence?')).closest('details') as HTMLDetailsElement;
      expect(details.open).toBe(false);
    });

    When('"What is a licence?" is opened', async () => {
      await userEvent.click(screen.getByText('What is a licence?'));
    });

    Then('the explanation names the licence, the key and the mint cost from the code', () => {
      expect(screen.getByText(/proof of who you are to your Mayor/)).toBeInTheDocument();
      expect(screen.getByText(/unlocked by your fingerprint and backed up as/)).toBeInTheDocument();
      expect(
        screen.getByText(`${mintCostSatoshis().toLocaleString('en-US')} testnet sats today`, { exact: false }),
      ).toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
});
