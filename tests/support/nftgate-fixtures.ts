// tests/support/nftgate-fixtures.ts — builds real transaction hex carrying a single
// nftgate typed record, the shape src/services/licence.ts reads back out. Built with
// @bsv/sdk's own Transaction/output encoding (not hand-assembled bytes), so a fixture
// stays valid if the wire format ever changes shape.
import { Transaction, Utils } from '@bsv/sdk';
import { encodeTypedRecordScript } from 'spell-forge-bsv';

function typedRecordTxHex(recordType: 'M' | 'TR', payload: object): string {
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
