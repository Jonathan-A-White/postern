import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chainConfig } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { KeyVault } from '../../src/key';
import { addressForPublicKey, checkLicence } from '../../src/services/licence';
import { createMnemonic, deriveMasterKey, publicKeyHexFromMasterKey } from '../../src/services/vault';
import { installMockAuthenticator, removeMockAuthenticator } from '../support/webauthn-mock';
import { FakeChainProvider } from '../support/fake-chain-provider';
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
  });

  afterEach(() => {
    removeMockAuthenticator();
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
    fakeProvider.addTransaction(address, 'e'.repeat(64), mintRecordTxHex(chainConfig.collectionId, address));
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

  it('unlocks an existing phrase-wrapped key by typing the phrase again', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<KeyVault />);

    await user.click(await screen.findByRole('button', { name: 'Generate a new key' }));
    const words = await screen.findAllByTestId('mnemonic-word');
    const mnemonic = words.map((word) => word.textContent).join(' ');
    await user.click(screen.getByRole('button', { name: "I've written it down" }));
    await screen.findByText('Key unlocked');
    unmount();

    render(<KeyVault />);
    await user.type(await screen.findByLabelText('Recovery phrase'), mnemonic);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Key unlocked')).toBeInTheDocument();
  });
});
