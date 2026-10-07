import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../src/data/db';
import { KeyVault } from '../../src/key';
import { chain, setChain, type Chain } from '../../src/chain';
import { addressForPublicKey, checkLicence } from '../../src/services/licence';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';
import { lock } from '../../src/services/keySession';
import { FakeChainProvider } from '../support/fake-chain-provider';
import { COCKPIT_COLLECTION, LEGACY_LICENCE_COLLECTION } from '../../src/services/collections';
import { mintRecordTxHex } from '../support/nftgate-fixtures';

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => fakeProvider };
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('KeyVault', () => {
  beforeEach(async () => {
    fakeProvider = new FakeChainProvider();
    await db.vault.clear();
    await db.settings.clear();
    lock();
  });

  afterEach(() => {
    removeMockAuthenticator();
    vi.unstubAllGlobals();
  });

  it('offers to generate or restore a key when none is stored yet', async () => {
    render(<KeyVault />);
    expect(await screen.findByRole('button', { name: 'Generate a new key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore from a phrase' })).toBeInTheDocument();
  });

  it('generates a key, shows the phrase once, and wraps it with a fingerprint passkey when PRF is available', async () => {
    installMockAuthenticator({ prfSupported: true });
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    const words = await screen.findAllByTestId('mnemonic-word');
    expect(words).toHaveLength(12);

    await user.click(screen.getByRole('button', { name: "I've written it down" }));

    expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
    const row = await db.vault.get('default');
    expect(row?.mode).toBe('prf');
  });

  it('falls back to phrase-wrapping the key when no platform passkey is available', async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    await screen.findAllByTestId('mnemonic-word');
    await user.click(screen.getByRole('button', { name: "I've written it down" }));

    expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
    const row = await db.vault.get('default');
    expect(row?.mode).toBe('phrase');
  });

  it('unlocks a phrase-wrapped key with the fingerprint of the original key', async () => {
    const mnemonic = createMnemonic();
    const expectedKey = await deriveMasterKey(mnemonic);
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText(`Key fingerprint: ${toHex(expectedKey.slice(0, 4))}`)).toBeInTheDocument();
  });

  it('rejects a recovery phrase with an unknown word, naming it', async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), 'not a real recovery phrase at all');
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not words? of the recovery list/i);
  });

  it('rejects a wordlist-valid recovery phrase with a bad checksum', async () => {
    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), 'abandon '.repeat(11) + 'zoo');
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid recovery phrase/i);
  });

  it('unlocks an existing fingerprint-wrapped key by fingerprint on a later visit', async () => {
    installMockAuthenticator({ prfSupported: true });
    const user = userEvent.setup();
    const { unmount } = render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    await screen.findAllByTestId('mnemonic-word');
    await user.click(screen.getByRole('button', { name: "I've written it down" }));
    await screen.findByText('Key unlocked');
    unmount();
    lock();

    render(<KeyVault />);
    expect(await screen.findByText('The key is locked.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Unlock with your fingerprint' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlock with your fingerprint' }));
    expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
  });

  it('copies exactly the twelve space-joined words to the clipboard, matching the words on screen', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    const words = await screen.findAllByTestId('mnemonic-word');
    const mnemonic = words.map((word) => word.textContent).join(' ');

    await user.click(screen.getByRole('button', { name: 'Copy the twelve words' }));

    expect(writeText).toHaveBeenCalledWith(mnemonic);
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(screen.getByTestId('mnemonic-words').textContent).toBe(mnemonic);
  });

  it('shows Licensed and hides the funding sentence and mint button once the cached licence check says held', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(COCKPIT_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);

    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Key unlocked');

    expect(await screen.findByText('Licensed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs .* testnet sats/)).not.toBeInTheDocument();
  });

  async function openUnlocked(mnemonic: string) {
    const user = userEvent.setup();
    render(<KeyVault />);
    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Key unlocked');
  }

  it("says a counted licence in the old collection is old, and offers 'Mint my licence in postern'", async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);

    await openUnlocked(mnemonic);

    expect(await screen.findByText('Licensed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'e'.repeat(64) })).toBeInTheDocument();
    expect(
      screen.getByText("This licence is in the old collection (spell-forge's). Mint one in postern."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint my licence in postern' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
  });

  it("applies the not-licensed balance rules to 'Mint my licence in postern'", async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);

    await openUnlocked(mnemonic);

    expect(await screen.findByText(/Needs .* testnet sats/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mint my licence in postern' })).toBeDisabled();
  });

  it('shows a licence in postern as plain Licensed, with no mint button and no old-collection line', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(COCKPIT_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);

    await openUnlocked(mnemonic);

    expect(await screen.findByText('Licensed')).toBeInTheDocument();
    expect(screen.queryByText(/old collection/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
  });

  it("offers today's 'Mint my licence (testnet)' when no licence is held", async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory([]);

    await openUnlocked(mnemonic);

    expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint my licence in postern' })).not.toBeInTheDocument();
    expect(screen.queryByText(/old collection/)).not.toBeInTheDocument();
  });

  it('checks the chain afresh when the cached held status has no collection (an old row)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const address = addressForPublicKey(publicKeyHexFromMasterKey(key));
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    // The check reads the confirmed history paged from WhatsOnChain (confirmedHistory.ts), not the provider's own.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const result = path.endsWith('/confirmed/history') ? [{ tx_hash: 'e'.repeat(64), height: 1 }] : [];
        return new Response(JSON.stringify({ result, nextPageToken: '', error: '' }), { status: 200 });
      }),
    );
    await db.settings.put({
      key: 'licence-status',
      value: { held: true, outpoint: { txid: 'e'.repeat(64), vout: 0 }, checkedAt: new Date().toISOString() },
    });

    await openUnlocked(mnemonic);

    expect(await screen.findByRole('button', { name: 'Mint my licence in postern' })).toBeInTheDocument();
  });

  // The licence check reads the confirmed history from WhatsOnChain (confirmedHistory.ts), not the provider's own.
  function stubHistory(txids: string[] | 'unreachable') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (txids === 'unreachable') return new Response('{}', { status: 503 });
        const path = new URL(String(input)).pathname;
        const result = path.endsWith('/confirmed/history') ? txids.map((tx_hash) => ({ tx_hash, height: 1 })) : [];
        return new Response(JSON.stringify({ result, nextPageToken: '', error: '' }), { status: 200 });
      }),
    );
  }

  async function markPending(txid: string) {
    await db.settings.put({ key: 'licence-mint-pending', value: { txid, broadcastAt: new Date().toISOString() } });
  }

  it("shows 'Minted: <txid>, waiting for the chain' and no mint button while a mint is pending (mw-7ijx65 AC1)", async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory([]);
    await markPending('9'.repeat(64));

    await openUnlocked(mnemonic);

    const line = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === `Minted: ${'9'.repeat(64)}, waiting for the chain`);
    expect(line).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '9'.repeat(64) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
  });

  it('shows no mint button while a mint is pending, even when the old collection still holds a licence (mw-7ijx65 AC1)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);
    stubHistory(['e'.repeat(64)]);
    await markPending('9'.repeat(64));

    await openUnlocked(mnemonic);

    await screen.findByText(/waiting for the chain/);
    expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
  });

  it('says the licence check could not reach WhatsOnChain, with no mint button (mw-7ijx65 AC2)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory('unreachable');

    await openUnlocked(mnemonic);

    expect(await screen.findByText(/Could not reach WhatsOnChain to check the licence/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Licensed')).not.toBeInTheDocument();
  });

  it('checks the licence again when the chain comes back, and then offers the mint (mw-7ijx65 AC2)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory('unreachable');
    await openUnlocked(mnemonic);
    await screen.findByText(/Could not reach WhatsOnChain to check the licence/);

    stubHistory([]);
    await userEvent.click(screen.getByRole('button', { name: 'Check the licence again' }));

    expect(await screen.findByRole('button', { name: 'Mint my licence (testnet)' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not reach WhatsOnChain/)).not.toBeInTheDocument();
  });

  it('shows the legacy line when the cached status is not-held but the chain holds a licence in the old collection (mw-7ijx65 AC3)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const address = addressForPublicKey(publicKeyHexFromMasterKey(key));
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    await db.settings.put({ key: 'licence-status', value: { held: false, checkedAt: new Date().toISOString() } });
    stubHistory(['e'.repeat(64)]);

    await openUnlocked(mnemonic);

    expect(
      await screen.findByText("This licence is in the old collection (spell-forge's). Mint one in postern."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mint my licence (testnet)' })).not.toBeInTheDocument();
  });

  it('keeps showing the legacy line from the cached status when the chain cannot be reached (mw-7ijx65 AC3)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const address = addressForPublicKey(publicKeyHexFromMasterKey(key));
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(LEGACY_LICENCE_COLLECTION, address));
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory('unreachable');

    await openUnlocked(mnemonic);

    expect(
      await screen.findByText("This licence is in the old collection (spell-forge's). Mint one in postern."),
    ).toBeInTheDocument();
  });

  it('hides the mint button the moment a mint succeeds, showing the pending line (mw-7ijx65 AC1)', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    await checkLicence(publicKeyHexFromMasterKey(key), fakeProvider);
    stubHistory([]);
    const restore = setChain({
      ...chain,
      balance: vi.fn(async () => 1_000_000),
      mint: vi.fn(async () => ({ txid: '8'.repeat(64) })),
    } as Chain);
    try {
      await openUnlocked(mnemonic);
      await userEvent.click(await screen.findByRole('button', { name: 'Mint my licence (testnet)' }));

      await screen.findByText(/waiting for the chain/);
      expect(screen.queryByRole('button', { name: /Mint my licence/ })).not.toBeInTheDocument();
    } finally {
      setChain(restore);
    }
  });

  it('wraps the testnet address and the minted licence link so long hex does not overflow the screen', async () => {
    const mnemonic = createMnemonic();
    const key = await deriveMasterKey(mnemonic);
    const publicKeyHex = publicKeyHexFromMasterKey(key);
    const address = addressForPublicKey(publicKeyHex);
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(COCKPIT_COLLECTION, address));
    await checkLicence(publicKeyHex, fakeProvider);

    const user = userEvent.setup();
    render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Restore from a phrase' }));
    await user.type(screen.getByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Key unlocked');
    await screen.findByText('Licensed');

    expect(screen.getByTestId('testnet-address')).toHaveClass('break-all', 'font-mono');
    const mintedLink = screen.getByRole('link', { name: /^[0-9a-f]{64}$/ });
    expect(mintedLink).toHaveClass('break-all', 'font-mono', 'underline');
  });

  it('unlocks an existing phrase-wrapped key by typing the phrase again', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    const words = await screen.findAllByTestId('mnemonic-word');
    const mnemonic = words.map((word) => word.textContent).join(' ');
    await user.click(screen.getByRole('button', { name: "I've written it down" }));
    await screen.findByText('Key unlocked');
    unmount();
    lock();

    render(<KeyVault />);
    await user.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
  });
});
