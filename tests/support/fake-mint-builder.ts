// tests/support/fake-mint-builder.ts — stands in for spell-forge-bsv's
// buildContractMintTransaction in tests: the real builder loads its contract bridge with
// import.meta.glob, which vitest cannot run (mw-1589l.3). This builds a real, signed
// transaction with the same output shape from the same parameters (see the package's
// license-contract.js): [0] a 1-sat output to the holder's key standing in for the License,
// [1] the Fuel, [2] the type-M record naming config.collectionId and the holder's address,
// [3] the issuer's change. It spends the first UTXO only.
import {
  P2PKH,
  PrivateKey,
  PublicKey,
  SatoshisPerKilobyte,
  Transaction,
  Utils,
} from "@bsv/sdk";
import type { BuildContractMintTransactionParams } from "spell-forge-bsv";

type EncodeTypedRecordScript =
  typeof import("spell-forge-bsv").encodeTypedRecordScript;

/**
 * Made inside a vi.mock factory, given the real encodeTypedRecordScript from importOriginal
 * (this file cannot import spell-forge-bsv itself: that import is the module being mocked).
 */
export function createFakeMintBuilder(
  encodeTypedRecordScript: EncodeTypedRecordScript,
) {
  return async function fakeBuildContractMintTransaction(
    params: BuildContractMintTransactionParams,
  ) {
    const { issuerKey, utxos, holderPubKey, mintFuelSatoshis, config } = params;
    if (utxos.length === 0)
      throw new Error(
        "No UTXOs available — fund the issuer wallet before minting",
      );
    const issuer = PrivateKey.fromWif(issuerKey);
    const holder = PublicKey.fromString(holderPubKey);
    const holderAddress = holder.toAddress(config.network);
    const utxo = utxos[0];

    const source = new Transaction();
    source.outputs[utxo.vout] = {
      satoshis: utxo.satoshis,
      lockingScript: new P2PKH().lock(issuer.toAddress(config.network)),
    };
    const transaction = new Transaction();
    transaction.addInput({
      sourceTransaction: source,
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(issuer),
    });
    transaction.addOutput({
      lockingScript: new P2PKH().lock(holderAddress),
      satoshis: 1,
    });
    transaction.addOutput({
      lockingScript: new P2PKH().lock(issuer.toAddress(config.network)),
      satoshis: mintFuelSatoshis ?? 0,
    });
    transaction.addOutput({
      lockingScript: encodeTypedRecordScript(
        "M",
        Utils.toArray(
          JSON.stringify({
            collection: config.collectionId,
            holder: holderAddress,
          }),
          "utf8",
        ),
      ),
      satoshis: 0,
    });
    transaction.addOutput({
      lockingScript: new P2PKH().lock(issuer.toAddress(config.network)),
      change: true,
    });
    await transaction.fee(new SatoshisPerKilobyte(config.feeRateSatPerKb));
    if (transaction.outputs.length < 4)
      throw new Error(
        "Not enough satoshis to mint a token, fund its Fuel and cover the fee",
      );
    await transaction.sign();
    return {
      transaction,
      hex: transaction.toHex(),
      txid: transaction.id("hex"),
      spentOutpoints: [{ txid: utxo.txid, vout: utxo.vout }],
    };
  };
}
