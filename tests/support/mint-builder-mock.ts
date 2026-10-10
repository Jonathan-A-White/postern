// tests/support/mint-builder-mock.ts — the factory for vi.mock('spell-forge-bsv') in the tests that issue a licence
// through the screen. Kept apart from issue-burst.ts: that file imports spell-forge-bsv, which the factory
// is still building, so a factory that imported it would wait on itself.
/**
 * The factory for vi.mock('spell-forge-bsv'): the fake mint builder, which also reads the source
 * transaction of every coin it is given through `provider`, as the real builder's addFundingInputs does.
 */
export async function mintBuilderMock(importOriginal: () => Promise<typeof import('spell-forge-bsv')>) {
  const actual = await importOriginal();
  const { createFakeMintBuilder } = await import('./fake-mint-builder');
  const fake = createFakeMintBuilder(actual.encodeTypedRecordScript);
  return {
    ...actual,
    buildContractMintTransaction: async (params: Parameters<typeof fake>[0]) => {
      for (const utxo of params.utxos) await params.provider.getTransactionHex(utxo.txid);
      return fake(params);
    },
  };
}

