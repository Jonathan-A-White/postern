// src/model/call.ts — what the Talk line screen knows about a call (docs/protocol.md §21):
// whether his Call me request is still waiting for the Mayor, and its time as he reads it.
import type { MessageRow } from '../data/db';
import { decodeCall } from '../services/call';

/** The time of day of `atSeconds` on this phone's clock, "14:05". */
export function clockHHMM(atSeconds: number): string {
  const date = new Date(atSeconds * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * When his newest Call me request was sent (Unix seconds), while the Mayor has not answered
 * it: nothing from him (a ring, or a Talk-line answer) has arrived at or after it. `rows` are
 * the call and talk records this phone holds, in any order.
 */
export function callSentAt(rows: MessageRow[]): number | undefined {
  let sent: number | undefined;
  for (const row of rows) {
    if (row.class !== 'call' || row.direction !== 'sent') continue;
    const call = decodeCall(row.plaintext);
    if (call?.role === 'request' && (sent === undefined || call.at > sent)) sent = call.at;
  }
  if (sent === undefined) return undefined;
  const answered = rows.some((row) => row.direction === 'received' && row.ts >= sent && (row.class === 'talk' || (row.class === 'call' && decodeCall(row.plaintext)?.role === 'ring')));
  return answered ? undefined : sent;
}
