// features/steps/key-vault.steps.tsx — runs features/key-vault.feature under
// vitest via @amiceli/vitest-cucumber. See gate.steps.tsx for why
// dont-cleanup-after-each is imported and cleanup() is called by hand: each
// scenario below calls cleanup() itself before rendering, since several
// scenarios render the same KeyVault component in this one file and the
// automatic per-test cleanup is disabled.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { KeyVault } from '../../src/key';
import { db } from '../../src/data/db';
import { createMnemonic, deriveMasterKey } from '../../src/services/vault';
import { installMockAuthenticator, removeMockAuthenticator } from '../../tests/support/webauthn-mock';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function freshScreen() {
  cleanup();
  removeMockAuthenticator();
  await db.vault.clear();
}

const feature = await loadFeature('features/key-vault.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: generating a new key shows the recovery phrase once', ({ Given, When, Then, And }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    When('"Generate a new key" is chosen', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
    });

    Then('a 12-word recovery phrase is shown', async () => {
      const words = await screen.findAllByTestId('mnemonic-word');
      expect(words).toHaveLength(12);
    });

    And('a button to confirm the phrase has been written down is shown', () => {
      expect(screen.getByRole('button', { name: "I've written it down" })).toBeInTheDocument();
    });
  });

  Scenario('AC-2: a fingerprint-capable phone wraps the key with the passkey', ({ Given, And, When, Then }) => {
    Given('a platform passkey with fingerprint unlock is available', async () => {
      await freshScreen();
      installMockAuthenticator({ prfSupported: true });
    });

    And('the key screen is opened', async () => {
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
    });

    Then('the key is unlocked', async () => {
      expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
    });

    And('the wrapped key is stored for unlock by fingerprint', async () => {
      const row = await db.vault.get('default');
      expect(row?.mode).toBe('prf');
    });
  });

  Scenario('AC-3: a phone without a fingerprint passkey falls back to the phrase', ({ Given, And, When, Then }) => {
    Given('no platform passkey is available', async () => {
      await freshScreen();
    });

    And('the key screen is opened', async () => {
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
    });

    Then('the key is unlocked', async () => {
      expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
    });

    And('the wrapped key is stored for unlock by the recovery phrase', async () => {
      const row = await db.vault.get('default');
      expect(row?.mode).toBe('phrase');
    });
  });

  Scenario('AC-4: the key restores on a new phone from the recovery phrase', ({ Given, When, Then }) => {
    let mnemonic = '';
    let expectedKey = new Uint8Array();

    Given('a fresh phone with no stored key', async () => {
      await freshScreen();
      mnemonic = createMnemonic();
      expectedKey = await deriveMasterKey(mnemonic);
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Restore from a phrase' });
    });

    When('the recovery phrase from a previously generated key is entered to restore it', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), mnemonic);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    });

    Then('the restored key matches the original key', async () => {
      expect(await screen.findByText(`Key fingerprint: ${toHex(expectedKey.slice(0, 4))}`)).toBeInTheDocument();
    });
  });
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
});
