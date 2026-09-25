import { chainConfig } from 'spell-forge-bsv';
import { describe, it, expect } from 'vitest';
import { mintCostSatoshis } from '../../src/services/mint';

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
