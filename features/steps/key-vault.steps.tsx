// features/steps/key-vault.steps.tsx — runs features/key-vault.feature under
// vitest via @amiceli/vitest-cucumber. See gate.steps.tsx for why
// dont-cleanup-after-each is imported and cleanup() is called by hand: each
// scenario below calls cleanup() itself before rendering, since several
// scenarios render the same KeyVault component in this one file and the
// automatic per-test cleanup is disabled.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { KeyVault } from '../../src/key';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
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

  Scenario(
    'AC-5: a capitalised, newline-trailed, double-spaced phrase still unlocks a phrase-wrapped key',
    ({ Given, When, Then }) => {
      let mnemonic = '';

      Given('a phrase-wrapped vault exists from a previously generated key', async () => {
        await freshScreen();
        const { unmount } = render(<KeyVault />);
        await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
        const words = await screen.findAllByTestId('mnemonic-word');
        mnemonic = words.map((word) => word.textContent).join(' ');
        await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
        await screen.findByText('Key unlocked');
        unmount();
        cleanup();
        render(<KeyVault />);
        await screen.findByRole('button', { name: 'Unlock' });
      });

      When(
        'the recovery phrase is typed with a capital first letter, a trailing newline and a double space and used to unlock',
        async () => {
          const words = mnemonic.split(' ');
          const capitalised = words[0][0].toUpperCase() + words[0].slice(1);
          const distorted = `${capitalised}  ${words.slice(1).join(' ')}\n`;
          await userEvent.type(screen.getByLabelText('Recovery phrase'), distorted);
          await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
        },
      );

      Then('the key is unlocked', async () => {
        expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
      });
    },
  );

  Scenario('AC-6: an unknown word in the recovery phrase is named in the error', ({ Given, When, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Restore from a phrase' });
    });

    When('a phrase containing the word "Aple" is submitted to restore', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
      const phrase = 'Aple ' + 'abandon '.repeat(10) + 'about';
      await userEvent.type(screen.getByLabelText('Recovery phrase'), phrase);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    });

    Then('the error names "Aple" as not a word of the recovery list', async () => {
      expect(await screen.findByRole('alert')).toHaveTextContent("'Aple' is not a word of the recovery list.");
    });
  });

  Scenario('AC-7: the locked screen names the recovery-phrase unlock mode', ({ Given, When, Then }) => {
    Given('a phrase-wrapped vault exists from a previously generated key', async () => {
      await freshScreen();
      const { unmount } = render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
      unmount();
    });

    When('the key screen is reopened', async () => {
      cleanup();
      render(<KeyVault />);
    });

    Then('the locked screen says the key is wrapped by the recovery phrase', async () => {
      expect(await screen.findByText('The key is locked.')).toBeInTheDocument();
      expect(
        await screen.findByText(/fingerprint unlock is not available on this phone or browser/i),
      ).toBeInTheDocument();
    });
  });

  Scenario(
    'AC-8: the generated words are shown on one line and the Copy button copies exactly the twelve words',
    ({ Given, And, When, Then }) => {
      let mnemonic = '';
      let writeText: ReturnType<typeof vi.fn>;

      Given('the key screen is opened', async () => {
        await freshScreen();
        writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText },
          configurable: true,
          writable: true,
        });
        render(<KeyVault />);
        await screen.findByRole('button', { name: 'Generate a new key' });
      });

      And('a new key has been generated', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
        const words = await screen.findAllByTestId('mnemonic-word');
        mnemonic = words.map((word) => word.textContent).join(' ');
      });

      When('"Copy the twelve words" is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Copy the twelve words' }));
      });

      Then('the twelve words are shown on a single line with no line breaks', () => {
        const container = screen.getByTestId('mnemonic-words');
        expect(container.textContent).toBe(mnemonic);
        expect(container.textContent).not.toMatch(/\n/);
      });

      And('the clipboard holds exactly the twelve space-joined words', () => {
        expect(writeText).toHaveBeenCalledWith(mnemonic);
      });
    },
  );

  Scenario('AC-9: a phrase pasted one word per line unlocks a phrase-wrapped key', ({ Given, When, Then }) => {
    let mnemonic = '';

    Given('a phrase-wrapped vault exists from a previously generated key', async () => {
      await freshScreen();
      const { unmount } = render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
      const words = await screen.findAllByTestId('mnemonic-word');
      mnemonic = words.map((word) => word.textContent).join(' ');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
      unmount();
      cleanup();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Unlock' });
    });

    When('the recovery phrase is typed one word per line and used to unlock', async () => {
      const oneWordPerLine = mnemonic.split(' ').join('\n');
      await userEvent.type(screen.getByLabelText('Recovery phrase'), oneWordPerLine);
      await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    });

    Then('the key is unlocked', async () => {
      expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
    });
  });

  Scenario('AC-10: no platform passkey names the fallback as unavailable', ({ Given, And, When, Then }) => {
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

    Then('the confirmation names the case as fingerprint unlock not available on this phone or browser', async () => {
      expect(
        await screen.findByText(/fingerprint unlock was not used: fingerprint unlock is not available/i),
      ).toBeInTheDocument();
    });

    And('the locked screen on reopening names the same case', async () => {
      cleanup();
      render(<KeyVault />);
      expect(
        await screen.findByText(/fingerprint unlock is not available on this phone or browser/i),
      ).toBeInTheDocument();
    });
  });

  Scenario('AC-11: a passkey created without PRF support names the fallback', ({ Given, And, When, Then }) => {
    Given('a platform passkey without PRF support is available', async () => {
      await freshScreen();
      installMockAuthenticator({ prfSupported: false });
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

    Then('the confirmation names the case as the passkey being created but reporting no PRF support', async () => {
      expect(
        await screen.findByText(/fingerprint unlock was not used: the passkey was created but reports no PRF support/i),
      ).toBeInTheDocument();
    });

    And('the locked screen on reopening names the same case', async () => {
      cleanup();
      render(<KeyVault />);
      expect(
        await screen.findByText(/the passkey was created but reports no PRF support/i),
      ).toBeInTheDocument();
    });
  });

  Scenario(
    'AC-12: a passkey that reports PRF support but returns no secret names the fallback',
    ({ Given, And, When, Then }) => {
      Given('a platform passkey that reports PRF support but returns no secret is available', async () => {
        await freshScreen();
        installMockAuthenticator({ prfSupported: true, prfGetResult: 'empty' });
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

      Then('the confirmation names the case as the passkey returning no usable fingerprint secret', async () => {
        expect(
          await screen.findByText(/fingerprint unlock was not used: the passkey did not return a usable fingerprint secret/i),
        ).toBeInTheDocument();
      });

      And('the locked screen on reopening names the same case', async () => {
        cleanup();
        render(<KeyVault />);
        expect(
          await screen.findByText(/the passkey did not return a usable fingerprint secret/i),
        ).toBeInTheDocument();
      });
    },
  );

  Scenario('AC-13: a PRF-capable phone offers to unlock by fingerprint on reopening', ({ Given, And, When, Then }) => {
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
      await screen.findByText('Key unlocked');
    });

    And('the key screen is reopened', () => {
      cleanup();
      render(<KeyVault />);
    });

    Then('the locked screen offers to unlock with your fingerprint', async () => {
      expect(await screen.findByText('The key is locked.')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
    });
  });

  Scenario(
    'mw-tfne4.18 AC2: a dismissed fingerprint prompt on the key vault screen says "Unlock cancelled"',
    ({ Given, When, Then, And }) => {
      Given('a PRF-wrapped vault exists and the fingerprint prompt will be dismissed', async () => {
        await freshScreen();
        installMockAuthenticator({ prfSupported: true, prfGetResult: 'not-allowed' });
        const key = await deriveMasterKey(createMnemonic());
        await vaultRepo.save({
          mode: 'prf',
          ciphertext: new ArrayBuffer(16),
          iv: new Uint8Array(12),
          credentialId: crypto.getRandomValues(new Uint8Array(16)).buffer,
          publicKeyHex: publicKeyHexFromMasterKey(key),
        });
        render(<KeyVault />);
        await screen.findByRole('button', { name: 'Unlock with your fingerprint' });
      });

      When('"Unlock with your fingerprint" is tapped', async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));
      });

      Then('the error says "Unlock cancelled. Tap Unlock to try again."', async () => {
        expect(await screen.findByRole('alert')).toHaveTextContent('Unlock cancelled. Tap Unlock to try again.');
      });

      And('the raw browser sentence and the w3.org link never appear', () => {
        expect(screen.queryByText(/timed out or was not allowed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/w3\.org/i)).not.toBeInTheDocument();
      });

      And('"Unlock with your fingerprint" is still offered', () => {
        expect(screen.getByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
      });
    },
  );
});

afterAll(() => {
  cleanup();
  removeMockAuthenticator();
});
