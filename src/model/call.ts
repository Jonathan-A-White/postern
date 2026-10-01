// src/model/call.ts — what the Talk line screen knows about a call (docs/protocol.md §21):
// whether his Call me request is still waiting for the Mayor, and its time as he reads it.
import type { MessageRow } from '../data/db';
import { decodeCall } from '../services/call';

/** The time of day of `atSeconds` on this phone's clock, "14:05". */
export function clockHHMM(atSeconds: number): string {
  const date = new Date(atSeconds * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** His waiting Call me request: when it was sent (Unix seconds), its id, and whether it went on chain rather than straight to the backend. */
export interface CallSent {
  at: number;
  txid: string;
  onChain: boolean;
}

/**
 * His newest Call me request, while the Mayor has not answered it: nothing from him (a
 * ring, or a Talk-line answer) has arrived at or after it. `rows` are the call and talk
 * records this phone holds, in any order. A direct delivery's id starts `direct:` (§9); any
 * other id is a transaction on chain (§21).
 */
export function callSent(rows: MessageRow[]): CallSent | undefined {
  let sent: CallSent | undefined;
  for (const row of rows) {
    if (row.class !== 'call' || row.direction !== 'sent') continue;
    const call = decodeCall(row.plaintext);
    if (call?.role === 'request' && (sent === undefined || call.at > sent.at)) {
      sent = { at: call.at, txid: row.txid, onChain: !row.txid.startsWith('direct:') };
    }
  }
  if (sent === undefined) return undefined;
  const { at } = sent;
  const answered = rows.some((row) => row.direction === 'received' && row.ts >= at && (row.class === 'talk' || (row.class === 'call' && decodeCall(row.plaintext)?.role === 'ring')));
  return answered ? undefined : sent;
}

/** When his newest Call me request was sent (Unix seconds), while the Mayor has not answered it. */
export function callSentAt(rows: MessageRow[]): number | undefined {
  return callSent(rows)?.at;
}

/** The note the Talk line keeps for the Mayor's last ring: when it rang, what it said, and whether he never answered it. */
export interface RingNote {
  txid: string;
  at: number;
  text: string;
  missed: boolean;
}

/**
 * The Mayor's newest ring that no turn of his has followed (docs/protocol.md §21): a turn he sent
 * at or after the ring clears it. `answered` is the txid of the ring he last opened the line from;
 * any other ring reads as a missed call.
 */
export function ringNote(rows: MessageRow[], answered: string | undefined): RingNote | undefined {
  let newest: RingNote | undefined;
  for (const row of rows) {
    if (row.class !== 'call' || row.direction !== 'received') continue;
    const call = decodeCall(row.plaintext);
    if (call?.role === 'ring' && (newest === undefined || call.at >= newest.at)) {
      newest = { txid: row.txid, at: call.at, text: call.text, missed: row.txid !== answered };
    }
  }
  if (newest === undefined) return undefined;
  const { at } = newest;
  return rows.some((row) => row.class === 'talk' && row.direction === 'sent' && row.ts >= at) ? undefined : newest;
}
