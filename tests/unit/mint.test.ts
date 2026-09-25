import { PrivateKey } from '@bsv/sdk';
import { chainConfig } from 'spell-forge-bsv';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../src/data/db';
import { addressForPublicKey, getCachedLicenceStatus, getMintPending } from '../../src/services/licence';
import { mintCostSatoshis, mintMyLicence } from '../../src/services/mint';
import { FakeChainProvider } from '../support/fake-chain-provider';

const { buildContractMintTransactionMock } = vi.hoisted(() => ({
  buildContractMintTransactionMock: vi.fn(),
}));

vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return { ...actual, buildContractMintTransaction: buildContractMintTransactionMock };
});

describe('mintCostSatoshis', () => {
  it('costs more than the Fuel plus the License output alone', () => {
    // mw-1589l.22: a balance of exactly Fuel + 1 builds a transaction @bsv/sdk refuses
    // (no room for its fee, nor the change output it keeps once funded) — see mint.ts's
    // mintMarginSatoshis comment for the arithmetic.
    expect(mintCostSatoshis(chainConfig)).toBeGreaterThan((chainConfig.mintFuelSatoshis ?? 0) + 1);
  });

  it('equals the Fuel, the License output, and the stated margin', () => {
    // Measured against a real build of buildContractMintTransaction (see mint.ts): at
    // chainConfig's feeRateSatPerKb of 1, the margin is 7 sat (6 sat fee + 1 sat minimum
    // change).
    const margin = 7;
    expect(mintCostSatoshis(chainConfig)).toBe((chainConfig.mintFuelSatoshis ?? 0) + 1 + margin);
  });
});

describe('mintMyLicence', () => {
  const KEY = PrivateKey.fromHex('55'.repeat(32));
  const PUBLIC_KEY_HEX = KEY.toPublicKey().toString();
  const ADDRESS = addressForPublicKey(PUBLIC_KEY_HEX);

  beforeEach(async () => {
    await db.settings.clear();
    buildContractMintTransactionMock.mockReset();
    buildContractMintTransactionMock.mockResolvedValue({ hex: 'deadbeef' });
  });

  it('marks the mint pending, and does not cache held:false, when the chain has not indexed it yet', async () => {
    const provider = new FakeChainProvider();
    provider.setUtxos(ADDRESS, [{ txid: 'a'.repeat(64), vout: 0, satoshis: 20_000 }]);
    provider.broadcastTxid = 'b'.repeat(64);
    // No addTransaction: the chain has not indexed the mint yet, mw-1589l.24's SEEN.

    const result = await mintMyLicence(new Uint8Array(KEY.toArray('be', 32)), provider);

    expect(result.txid).toBe('b'.repeat(64));
    expect(await getCachedLicenceStatus()).toBeUndefined();
    expect(await getMintPending()).toMatchObject({ txid: 'b'.repeat(64) });
  });
});
