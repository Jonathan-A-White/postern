import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { Gate } from '../../src/gate';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { checkLicence, setMintPending } from '../../src/services/licence';
import { FakeChainProvider } from '../support/fake-chain-provider';

let fakeProvider = new FakeChainProvider();

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => fakeProvider };
});

const TEST_KEY = PrivateKey.fromHex('44'.repeat(32));
const TEST_PUBLIC_KEY_HEX = TEST_KEY.toPublicKey().toString();

beforeEach(async () => {
  fakeProvider = new FakeChainProvider();
  await db.vault.clear();
  await db.settings.clear();
});

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

describe('Gate', () => {
  it('renders the app name and the locked message', () => {
    render(<Gate />);
    expect(screen.getByText('The gate is locked')).toBeInTheDocument();
    expect(screen.getByText('Postern')).toBeInTheDocument();
  });

  it('renders the app version', () => {
    render(<Gate />);
    expect(screen.getByText(__APP_VERSION__, { exact: false })).toBeInTheDocument();
  });

  it('offers a link to mint a licence when a key has no licence yet', async () => {
    await saveTestVault();

    render(<Gate />);
    const link = await screen.findByRole('link', { name: 'Mint a licence' });
    expect(link).toHaveAttribute('href', '?screen=key');
  });

  it('shows a checking state on Check again until the answer lands', async () => {
    await saveTestVault();
    render(<Gate />);
    await screen.findByRole('button', { name: 'Check again' });

    let resolvePause: () => void = () => {};
    fakeProvider.pauseUntil = new Promise((resolve) => {
      resolvePause = resolve;
    });

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();

    fakeProvider.pauseUntil = null;
    resolvePause();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
  });

  it('shows the mint as pending instead of "No licence found" while it is unindexed', async () => {
    await saveTestVault();
    await setMintPending('c'.repeat(64));

    render(<Gate />);

    expect(
      await screen.findByText('Your licence mint is broadcast; the chain can take a minute to show it'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No licence found')).not.toBeInTheDocument();
  });

  it('does not trust a cached no-licence answer while a mint is pending and the chain is unreachable', async () => {
    await saveTestVault();
    await checkLicence(TEST_PUBLIC_KEY_HEX, fakeProvider); // caches held:false
    await setMintPending('d'.repeat(64));
    fakeProvider.offline = true;

    render(<Gate />);

    expect(
      await screen.findByText('Your licence mint is broadcast; the chain can take a minute to show it'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No licence found')).not.toBeInTheDocument();
  });
});
