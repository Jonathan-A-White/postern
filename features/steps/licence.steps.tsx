// features/steps/licence.steps.tsx — runs features/licence.feature under vitest via
// @amiceli/vitest-cucumber. See gate.steps.tsx and key-vault.steps.tsx for why
// dont-cleanup-after-each is imported and cleanup() is called by hand.
//
// spell-forge-bsv's createChainProvider() is replaced for this whole file with one
// returning `fakeProvider`, same as gate.steps.tsx. buildContractMintTransaction is also
// replaced: it loads a scrypt-ts contract bridge via import.meta.glob, which only resolves
// under a real Vite build/dev transform — not under vitest's node_modules externalization
// (confirmed by hand while building this story) — so every scenario here fakes the built
// transaction's hex and drives outcomes through the fake provider's broadcast instead.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { chainConfig } from 'spell-forge-bsv';
import { KeyVault } from '../../src/key';
import { Gate } from '../../src/gate';
import { db } from '../../src/data/db';
import { addressForPublicKey, getCachedLicenceStatus } from '../../src/services/licence';
import { mintCostSatoshis } from '../../src/services/mint';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { FakeChainProvider } from '../../tests/support/fake-chain-provider';
import { mintRecordTxHex } from '../../tests/support/nftgate-fixtures';

const { buildContractMintTransactionMock } = vi.hoisted(() => ({
  buildContractMintTransactionMock: vi.fn(),
}));

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return {
    ...actual,
    createChainProvider: () => fakeProvider,
    buildContractMintTransaction: buildContractMintTransactionMock,
  };
});

const FUNDED_MNEMONIC = createMnemonic();
const MINT_TXID = 'e'.repeat(64);

async function freshScreen(): Promise<void> {
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  fakeProvider = new FakeChainProvider();
  buildContractMintTransactionMock.mockReset();
  buildContractMintTransactionMock.mockResolvedValue({ hex: 'deadbeef' });
}

const feature = await loadFeature('features/licence.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: mint is not offered while the key is locked', ({ Given, When, Then }) => {
    Given('a phrase-wrapped vault exists from a previously generated key', async () => {
      await freshScreen();
      const { unmount } = render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
      unmount();
    });

    When('the key screen is reopened', () => {
      cleanup();
      render(<KeyVault />);
    });

    Then('no "Mint my licence (testnet)" button is shown', async () => {
      await screen.findByText('The key is locked.');
      expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
    });
  });

  Scenario('AC-2: mint is disabled while unlocked with no testnet balance', ({ Given, When, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    Then('the "Mint my licence (testnet)" button is disabled', async () => {
      expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeDisabled();
    });
  });

  Scenario(
    'AC-3: minting succeeds, shows the txid, and the gate opens on the next check',
    ({ Given, And, When, Then }) => {
      Given('the key screen is opened', async () => {
        await freshScreen();
        render(<KeyVault />);
        await screen.findByRole('button', { name: 'Restore from a phrase' });
      });

      And('the key is restored from a phrase whose testnet balance covers the mint', async () => {
        const key = await deriveMasterKey(FUNDED_MNEMONIC);
        const publicKeyHex = publicKeyHexFromMasterKey(key);
        const address = addressForPublicKey(publicKeyHex);
        fakeProvider.setUtxos(address, [{ txid: 'a'.repeat(64), vout: 0, satoshis: 20_000 }]);
        fakeProvider.broadcastTxid = MINT_TXID;
        fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(chainConfig.collectionId, address));

        await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
        await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
        await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByText('Key unlocked');
      });

      When('"Mint my licence (testnet)" is chosen', async () => {
        await userEvent.click(await screen.findByRole('button', { name: 'Mint my licence (testnet)' }));
      });

      Then('the txid is shown with a link to WhatsOnChain testnet', async () => {
        const link = await screen.findByRole('link', { name: MINT_TXID });
        expect(link).toHaveAttribute('href', `https://test.whatsonchain.com/tx/${MINT_TXID}`);
      });

      And('the gate opens on the next check', async () => {
        cleanup();
        render(<Gate />);
        expect(await screen.findByText('Licensed')).toBeInTheDocument();
      });
    },
  );

  Scenario('AC-4: a broadcast failure is shown and nothing is cached', ({ Given, And, When, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Restore from a phrase' });
    });

    And('the key is restored from a phrase whose testnet balance covers the mint', async () => {
      const key = await deriveMasterKey(FUNDED_MNEMONIC);
      const publicKeyHex = publicKeyHexFromMasterKey(key);
      const address = addressForPublicKey(publicKeyHex);
      fakeProvider.setUtxos(address, [{ txid: 'a'.repeat(64), vout: 0, satoshis: 20_000 }]);

      await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await screen.findByText('Key unlocked');
    });

    And('the provider will fail to broadcast', () => {
      fakeProvider.broadcastError = 'WhatsOnChain said 500: node rejected the transaction';
    });

    When('"Mint my licence (testnet)" is chosen', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Mint my licence (testnet)' }));
    });

    Then("the provider's error is shown in words", async () => {
      expect(await screen.findByText('WhatsOnChain said 500: node rejected the transaction')).toBeInTheDocument();
    });

    And('nothing is cached', async () => {
      expect(await getCachedLicenceStatus()).toBeUndefined();
    });
  });

  Scenario('AC-5: an unfunded key names the sats it needs to mint', ({ Given, When, Then, And }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    Then("the screen shows the key's testnet address and a balance of 0 sats", async () => {
      expect(await screen.findByTestId('testnet-address')).not.toBeEmptyDOMElement();
      expect(await screen.findByText('Balance: 0 sats')).toBeInTheDocument();
    });

    And('the screen says it needs 10,008 testnet sats sent to that address', async () => {
      const address = screen.getByTestId('testnet-address').textContent;
      expect(
        await screen.findByText(`Needs 10,008 testnet sats; this key holds 0. Send testnet sats to ${address}.`),
      ).toBeInTheDocument();
    });
  });

  Scenario('AC-6: a balance lookup failure names the reason and offers Retry', ({ Given, And, When, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    And('the chain is unreachable', () => {
      fakeProvider.offline = true;
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    Then('the screen shows balance unavailable from WhatsOnChain naming the reason', async () => {
      expect(
        await screen.findByText('Balance unavailable (WhatsOnChain): the chain is unreachable'),
      ).toBeInTheDocument();
    });

    And('a "Retry" control is offered', () => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  Scenario('AC-7: retrying after funding the key enables the mint button', ({ Given, And, When, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Generate a new key' });
    });

    And('the chain is unreachable', () => {
      fakeProvider.offline = true;
    });

    When('a new key is generated and the phrase is confirmed', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Generate a new key' }));
      await screen.findAllByTestId('mnemonic-word');
      await userEvent.click(screen.getByRole('button', { name: "I've written it down" }));
      await screen.findByText('Key unlocked');
    });

    And('the chain is funded with 20,000 sats and "Retry" is chosen', async () => {
      await screen.findByRole('button', { name: 'Retry' });
      const address = screen.getByTestId('testnet-address').textContent ?? '';
      fakeProvider.offline = false;
      fakeProvider.setUtxos(address, [{ txid: 'a'.repeat(64), vout: 0, satoshis: 20_000 }]);
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    Then('the "Mint my licence (testnet)" button is enabled', async () => {
      expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeEnabled();
    });
  });

  Scenario(
    'mw-1589l.22 AC2a: a balance of exactly the Fuel plus the License leaves Mint disabled',
    ({ Given, And, Then }) => {
      Given('the key screen is opened', async () => {
        await freshScreen();
        render(<KeyVault />);
        await screen.findByRole('button', { name: 'Restore from a phrase' });
      });

      And('the key is restored from a phrase funded with exactly the Fuel plus the License token', async () => {
        const key = await deriveMasterKey(FUNDED_MNEMONIC);
        const publicKeyHex = publicKeyHexFromMasterKey(key);
        const address = addressForPublicKey(publicKeyHex);
        fakeProvider.setUtxos(address, [
          { txid: 'a'.repeat(64), vout: 0, satoshis: (chainConfig.mintFuelSatoshis ?? 0) + 1 },
        ]);

        await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
        await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
        await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByText('Key unlocked');
      });

      Then('the "Mint my licence (testnet)" button is disabled', async () => {
        expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeDisabled();
      });
    },
  );

  Scenario("mw-1589l.22 AC2b: a balance covering the mint's stated cost enables Mint", ({ Given, And, Then }) => {
    Given('the key screen is opened', async () => {
      await freshScreen();
      render(<KeyVault />);
      await screen.findByRole('button', { name: 'Restore from a phrase' });
    });

    And("the key is restored from a phrase funded with exactly the mint's stated cost", async () => {
      const key = await deriveMasterKey(FUNDED_MNEMONIC);
      const publicKeyHex = publicKeyHexFromMasterKey(key);
      const address = addressForPublicKey(publicKeyHex);
      fakeProvider.setUtxos(address, [{ txid: 'a'.repeat(64), vout: 0, satoshis: mintCostSatoshis() }]);

      await userEvent.click(screen.getByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await screen.findByText('Key unlocked');
    });

    Then('the "Mint my licence (testnet)" button is enabled', async () => {
      expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeEnabled();
    });
  });
});

afterAll(() => {
  cleanup();
});
