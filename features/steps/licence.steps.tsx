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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { chainConfig } from 'spell-forge-bsv';
import { KeyVault } from '../../src/key';
import { COCKPIT_COLLECTION, LEGACY_LICENCE_COLLECTION } from '../../src/services/collections';
import { db } from '../../src/data/db';
import { addressForPublicKey, checkLicence, getCachedLicenceStatus, getMintPending } from '../../src/services/licence';
import { mintCostSatoshis } from '../../src/services/mint';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { lock } from '../../src/services/keySession';
import { resetSharedChainReads } from '../../src/services/sharedChainReads';
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

// The Key screen's Issue section reads /api/me; here it answers an app key (no collections),
// so the only Retry on screen is the mint's own.
vi.mock('../../src/services/me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/me')>()),
  fetchMe: vi.fn().mockResolvedValue({ pubkey: '', mayor: '', network: 'testnet', features: ['me'] }),
}));

const FUNDED_MNEMONIC = createMnemonic();
const MINT_TXID = 'e'.repeat(64);

// The licence check on the Key screen reads the confirmed history from WhatsOnChain
// (confirmedHistory.ts), not the provider's own: this answers it from the fake provider's
// state (an empty history, or a 503 while the fake is offline), as the history of `historyTxids`.
let historyTxids: string[] = [];

function stubWhatsOnChainHistory(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (fakeProvider.offline) return new Response('{}', { status: 503 });
      const isHistory = new URL(String(input)).pathname.endsWith('/confirmed/history');
      const result = isHistory ? historyTxids.map((tx_hash) => ({ tx_hash, height: 1 })) : [];
      return new Response(JSON.stringify({ result, nextPageToken: '', error: '' }), { status: 200 });
    }),
  );
}

async function freshScreen(): Promise<void> {
  stubWhatsOnChainHistory();
  historyTxids = [];
  cleanup();
  await db.vault.clear();
  await db.settings.clear();
  lock();
  fakeProvider = new FakeChainProvider();
  resetSharedChainReads(); // the same txid carries different bytes in another scenario
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
      lock();
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
      await screen.findByText(/Balance: \d+ sats/);
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
        const publicKeyHex = publicKeyHexFromMasterKey(await deriveMasterKey(FUNDED_MNEMONIC));
        const status = await checkLicence(publicKeyHex, fakeProvider);
        expect(status.held).toBe(true);
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

    And('no licence and no pending mint are cached', async () => {
      expect((await getCachedLicenceStatus())?.held).not.toBe(true);
      expect(await getMintPending()).toBeUndefined();
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
      const expectedText = `Needs 10,008 testnet sats; this key holds 0. Send testnet sats to ${address}.`;
      expect(
        await screen.findByText(
          (_, element) => element?.tagName.toLowerCase() === 'p' && element.textContent === expectedText,
        ),
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
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Mint my licence (testnet)' })).toBeEnabled();
      });
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
        await screen.findByText(/Balance: \d+ sats/);
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
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Mint my licence (testnet)' })).toBeEnabled();
      });
    });
  });

  Scenario('mw-1589l.25 AC1: a licensed key is not asked to mint again', ({ Given, When, Then, And }) => {
    Given('a key already holds a licence', async () => {
      await freshScreen();
      const key = await deriveMasterKey(FUNDED_MNEMONIC);
      const publicKeyHex = publicKeyHexFromMasterKey(key);
      const address = addressForPublicKey(publicKeyHex);
      fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(COCKPIT_COLLECTION, address));
      await checkLicence(publicKeyHex, fakeProvider);
    });

    When('the key screen is opened and unlocked', async () => {
      render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await screen.findByText('Key unlocked');
    });

    Then('the screen says "Licensed" instead of asking to fund or mint', async () => {
      expect(await screen.findByText('Licensed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Needs .* testnet sats/)).not.toBeInTheDocument();
    });

    And('the balance and "Refresh balance" are still shown', async () => {
      expect(await screen.findByText(/Balance: \d+ sats/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh balance' })).toBeInTheDocument();
    });
  });

  Scenario('mw-1589l.26 AC1: the mint block offers a collapsed "What is a licence?" explanation', ({ Given, When, Then }) => {
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

  Scenario('mw-1589l.26 AC3: a licensed key shows no mint block and no explanation control', ({ Given, When, Then }) => {
    Given('a key already holds a licence', async () => {
      await freshScreen();
      const key = await deriveMasterKey(FUNDED_MNEMONIC);
      const publicKeyHex = publicKeyHexFromMasterKey(key);
      const address = addressForPublicKey(publicKeyHex);
      fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(COCKPIT_COLLECTION, address));
      await checkLicence(publicKeyHex, fakeProvider);
    });

    When('the key screen is opened and unlocked', async () => {
      render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await screen.findByText('Key unlocked');
    });

    Then('no "What is a licence?" control is offered', async () => {
      await screen.findByText('Licensed');
      expect(screen.queryByText('What is a licence?')).not.toBeInTheDocument();
    });
  });

  Scenario(
    'mw-kiubh7.1 AC1: a licence in the old collection says so and offers the mint in postern',
    ({ Given, When, Then, And }) => {
      Given('a key already holds a licence in the old collection', async () => {
        await freshScreen();
        const key = await deriveMasterKey(FUNDED_MNEMONIC);
        const publicKeyHex = publicKeyHexFromMasterKey(key);
        const address = addressForPublicKey(publicKeyHex);
        fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
        historyTxids = [MINT_TXID];
        await checkLicence(publicKeyHex, fakeProvider);
      });

      When('the key screen is opened and unlocked', async () => {
        render(<KeyVault />);
        await userEvent.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
        await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
        await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByText('Key unlocked');
      });

      Then('the screen says "Licensed" and that the licence is in the old collection', async () => {
        expect(await screen.findByText('Licensed')).toBeInTheDocument();
        expect(
          screen.getByText("This licence is in the old collection (spell-forge's). Mint one in postern."),
        ).toBeInTheDocument();
      });

      And('"Mint my licence in postern" is offered and "Mint my licence (testnet)" is not', () => {
        expect(screen.getByRole('button', { name: 'Mint my licence in postern' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
      });
    },
  );

  Scenario('mw-kiubh7.1 AC2: a licence in postern shows no mint button', ({ Given, When, Then }) => {
    Given('a key already holds a licence in postern', async () => {
      await freshScreen();
      const key = await deriveMasterKey(FUNDED_MNEMONIC);
      const publicKeyHex = publicKeyHexFromMasterKey(key);
      const address = addressForPublicKey(publicKeyHex);
      fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(COCKPIT_COLLECTION, address));
      await checkLicence(publicKeyHex, fakeProvider);
    });

    When('the key screen is opened and unlocked', async () => {
      render(<KeyVault />);
      await userEvent.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
      await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await screen.findByText('Key unlocked');
    });

    Then('the screen says "Licensed" with no mint button of either kind', async () => {
      await screen.findByText('Licensed');
      expect(screen.queryByText(/old collection/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
    });
  });

  const openKeyScreen = async () => {
    render(<KeyVault />);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await userEvent.type(screen.getByLabelText('Recovery phrase'), FUNDED_MNEMONIC);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Key unlocked');
  };

  Scenario(
    'mw-7ijx65 AC1: a mint still waiting for the chain shows its txid and no mint button',
    ({ Given, When, Then, And }) => {
      Given('a key has sent a mint the chain has not shown yet', async () => {
        await freshScreen();
        const key = await deriveMasterKey(FUNDED_MNEMONIC);
        await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
        await db.settings.put({
          key: 'licence-mint-pending',
          value: { txid: MINT_TXID, broadcastAt: new Date().toISOString() },
        });
      });

      When('the key screen is opened and unlocked', openKeyScreen);

      Then('the screen says "Minted:" with that txid and ", waiting for the chain"', async () => {
        const line = await screen.findByText(
          (_, el) => el?.tagName === 'P' && el.textContent === `Minted: ${MINT_TXID}, waiting for the chain`,
        );
        expect(line).toBeInTheDocument();
      });

      And('no mint button of either kind is offered', () => {
        expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-7ijx65 AC2: a licence check that cannot reach WhatsOnChain says so and offers no mint',
    ({ Given, When, Then, And }) => {
      Given('a key whose licence check cannot reach WhatsOnChain', async () => {
        await freshScreen();
        fakeProvider.offline = true;
      });

      When('the key screen is opened and unlocked', openKeyScreen);

      Then('the screen says the licence could not be checked', async () => {
        expect(await screen.findByText(/Could not reach WhatsOnChain to check the licence/)).toBeInTheDocument();
      });

      And('no mint button of either kind is offered', () => {
        expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
      });

      And('"Check the licence again" is offered', () => {
        expect(screen.getByRole('button', { name: 'Check the licence again' })).toBeInTheDocument();
      });
    },
  );

  Scenario(
    'mw-7ijx65 AC3: a stale cache that says no licence does not hide a licence in the old collection',
    ({ Given, When, Then }) => {
      Given('a key whose cached status says no licence but whose chain holds one in the old collection', async () => {
        await freshScreen();
        const key = await deriveMasterKey(FUNDED_MNEMONIC);
        const address = addressForPublicKey(publicKeyHexFromMasterKey(key));
        fakeProvider.addTransaction(address, MINT_TXID, mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
        historyTxids = [MINT_TXID];
        await db.settings.put({ key: 'licence-status', value: { held: false, checkedAt: new Date().toISOString() } });
      });

      When('the key screen is opened and unlocked', openKeyScreen);

      Then('the screen says "Licensed" and that the licence is in the old collection', async () => {
        expect(await screen.findByText('Licensed')).toBeInTheDocument();
        expect(
          screen.getByText("This licence is in the old collection (spell-forge's). Mint one in postern."),
        ).toBeInTheDocument();
      });
    },
  );
});

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});
