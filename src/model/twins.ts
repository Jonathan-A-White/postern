import type { MessageRow } from '../data/db';

/** A direct delivery's id starts `direct:` (docs/protocol.md §9); any other txid is a transaction. */
export const isDirect = (row: Pick<MessageRow, 'txid'>): boolean => row.txid.startsWith('direct:');

/** The Mayor answers a chain-borne post twice: direct (carrying its channel and bead) and, on chain,
 * the same record again under a transaction id. Two rows are the same message when the ciphertext,
 * sender, recipient and time all match (mw-f758y.40). */
export function sameMessage(a: Pick<MessageRow, 'ciphertext' | 'from' | 'to' | 'ts'>, b: Pick<MessageRow, 'ciphertext' | 'from' | 'to' | 'ts'>): boolean {
  return a.ts === b.ts && a.ciphertext === b.ciphertext && a.from === b.from && a.to === b.to;
}

/** The rows that duplicate another row in `rows`: of each same-message group the first direct row is
 * kept (else the first row), the rest are returned. A row with no ciphertext is never a twin. */
export function twinsToDrop<T extends MessageRow>(rows: T[]): T[] {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const row of rows) {
    const at = row.ciphertext ? kept.findIndex((other) => sameMessage(other, row)) : -1;
    if (at < 0) {
      kept.push(row);
    } else if (isDirect(row) && !isDirect(kept[at])) {
      dropped.push(kept[at]);
      kept[at] = row;
    } else {
      dropped.push(row);
    }
  }
  return dropped;
}
