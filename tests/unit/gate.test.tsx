import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PrivateKey } from '@bsv/sdk';
import { Gate } from '../../src/gate';
import { db } from '../../src/data/db';
import { vaultRepo } from '../../src/data/repositories';
import { FakeChainProvider } from '../support/fake-chain-provider';

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, createChainProvider: () => new FakeChainProvider() };
});

const TEST_KEY = PrivateKey.fromHex('44'.repeat(32));
const TEST_PUBLIC_KEY_HEX = TEST_KEY.toPublicKey().toString();

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
    await db.vault.clear();
    await vaultRepo.save({
      mode: 'phrase',
      ciphertext: new Uint8Array([1]).buffer,
      iv: new Uint8Array(12),
      salt: new Uint8Array(16),
      prfFallbackReason: 'webauthn-unavailable',
      publicKeyHex: TEST_PUBLIC_KEY_HEX,
    });

    render(<Gate />);
    const link = await screen.findByRole('link', { name: 'Mint a licence' });
    expect(link).toHaveAttribute('href', '?screen=key');
  });
});
