import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/mint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/mint')>();
  return { ...actual, mintCostSatoshis: vi.fn(actual.mintCostSatoshis) };
});

import { LicenceExplainer } from '../../src/licence';
import { mintCostSatoshis } from '../../src/services/mint';

describe('LicenceExplainer', () => {
  it('is collapsed by default and opens on tap, naming the licence, the key and the cost', async () => {
    render(<LicenceExplainer />);

    const details = screen.getByText('What is a licence?').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await userEvent.click(screen.getByText('What is a licence?'));

    expect(details.open).toBe(true);
    expect(screen.getByText(/proof of who you are to your Mayor/)).toBeInTheDocument();
    expect(screen.getByText(/unlocked by your fingerprint and backed up as/)).toBeInTheDocument();
    expect(screen.getByText(/10,008 testnet sats/)).toBeInTheDocument();
  });

  it('renders the mint cost from mintCostSatoshis, following a changed mock', async () => {
    vi.mocked(mintCostSatoshis).mockReturnValue(12_345);

    render(<LicenceExplainer />);
    await userEvent.click(screen.getByText('What is a licence?'));

    expect(screen.getByText(/12,345 testnet sats/)).toBeInTheDocument();
  });
});
