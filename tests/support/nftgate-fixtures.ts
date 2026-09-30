// tests/support/nftgate-fixtures.ts — builds real transaction hex carrying a single
// nftgate typed record, the shape src/services/licence.ts reads back out. Built with
// @bsv/sdk's own Transaction/output encoding (not hand-assembled bytes), so a fixture
// stays valid if the wire format ever changes shape.
import { P2PKH, type PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { encodeTypedRecordScript } from 'spell-forge-bsv';

function typedRecordTxHex(recordType: 'M' | 'TR' | 'W', payload: object): string {
  const tx = new Transaction();
  tx.addOutput({
    lockingScript: encodeTypedRecordScript(recordType, Utils.toArray(JSON.stringify(payload), 'utf8')),
    satoshis: 0,
  });
  return tx.toHex();
}

/** A mint (type-M) record naming `holderAddress` as the holder of `collection`. */
export function mintRecordTxHex(collection: string, holderAddress: string): string {
  return typedRecordTxHex('M', { collection, holder: holderAddress });
}

/** A transfer (type-TR) record moving the token at `origin` ("txid:vout") to `toAddress`. */
export function transferRecordTxHex(origin: string, toAddress: string): string {
  return typedRecordTxHex('TR', { origin, to: toAddress });
}

/**
 * An issuer's revoke (type-W record {kind: 'revoke', origin}): ends the licence whose
 * mint output is `origin` ("txid:vout"). The backend reads it only from a transaction the
 * issuer key signed (server/internal/licence, docs/protocol.md §16); this fixture carries
 * the record alone, the app-side shape of the same case.
 */
export function revokeRecordTxHex(origin: string): string {
  return typedRecordTxHex('W', { kind: 'revoke', origin });
}

/**
 * A record transaction `key` signed: one P2PKH input spending a coin of the key's own
 * (its scriptSig pushes the key's public key, which is how issuedLicences tells whose
 * transaction it is), and one typed record output. `spendVout` varies the input so two
 * fixtures from one key are different transactions.
 */
export async function signedRecordTxHex(
  key: PrivateKey,
  recordType: 'M' | 'TR' | 'W',
  payload: object,
  spendVout = 0,
): Promise<string> {
  const source = new Transaction();
  source.outputs[spendVout] = { satoshis: 5_000, lockingScript: new P2PKH().lock(key.toAddress('testnet')) };
  const tx = new Transaction();
  tx.addInput({
    sourceTransaction: source,
    sourceTXID: 'd'.repeat(64),
    sourceOutputIndex: spendVout,
    unlockingScriptTemplate: new P2PKH().unlock(key),
  });
  tx.addOutput({
    lockingScript: encodeTypedRecordScript(recordType, Utils.toArray(JSON.stringify(payload), 'utf8')),
    satoshis: 0,
  });
  await tx.sign();
  return tx.toHex();
}
