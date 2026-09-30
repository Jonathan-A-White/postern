// src/push/tapTarget.ts — where a tap on a push notification lands (mw-f758y.25).
// A push about a record carries its txid and class, never its plaintext, so the
// thread it belongs to is only known once the phone has that message decrypted.
// Imported by src/sw.ts's notificationclick handler (which asks the same IndexedDB
// the app writes) and by the notice screen the tap otherwise lands on.
import type { MessageClass, MessageRow } from '../data/db';
import { messagesRepo } from '../data/repositories/messages-repo';
import { formatRoute, threadHrefFor } from '../nav/route';
import { decodeThreadedMessage } from '../services/threads';
import { CLASS_URLS } from './classOptions';

/** The longest chain of replies followed to a root: threads are one level deep, so this only bounds a tangled one. */
const MAX_CHAIN = 50;

export interface TapData {
  txid?: string;
  class?: MessageClass;
  url?: string;
}

/** The txid a stored message answers as a reply (docs/protocol.md §14): only a
 * plain text message counts, never a transcript. */
function repliedTo(row: MessageRow): string | undefined {
  if (row.class !== 'message' || row.plaintext === undefined) return undefined;
  const body = decodeThreadedMessage(row.plaintext);
  return body.re !== undefined && body.role === undefined ? body.re : undefined;
}

/** The txid of the root of the reply thread this message belongs to: the post its
 * `re` chain ends at among the rows `find` knows of the same channel, or the
 * message's own txid when it answers nothing the phone holds (§14 keeps it a root). */
function rootTxidOf(row: MessageRow, find: (txid: string) => MessageRow | undefined): string {
  const seen = new Set([row.txid.toLowerCase()]);
  let current = row;
  for (;;) {
    const target = repliedTo(current);
    const next = target === undefined ? undefined : find(target);
    if (!next || next.thread !== row.thread) return current.txid;
    if (seen.has(next.txid.toLowerCase())) return row.txid;
    seen.add(next.txid.toLowerCase());
    current = next;
  }
}

/** The thread's URL for a message the phone has already decrypted (or given up
 * on: the general thread), or undefined while its thread is still unknown. A
 * reply in any channel opens the reply thread of its post, the route 'N replies'
 * opens; `rows` are the messages the chain of `re` is followed through. */
export function threadUrlOfMessage(row: MessageRow | undefined, rows: MessageRow[] = []): string | undefined {
  if (!row) return undefined;
  if (row.plaintext !== undefined && repliedTo(row) !== undefined) {
    const byTxid = new Map(rows.map((other) => [other.txid.toLowerCase(), other]));
    const root = rootTxidOf(row, (txid) => byTxid.get(txid.toLowerCase()));
    // In a bead's or a named channel a `re` naming nothing of it leaves the message a post (§14): its channel opens.
    // (General keeps opening the message as the root of its own thread, as mw-gq6.160 settled.)
    if (root.toLowerCase() !== row.txid.toLowerCase() || !row.thread) return `/${formatRoute({ view: 'talk', thread: row.thread ?? 'general', root })}`;
  }
  if (row.thread) return `/${threadHrefFor(row.thread)}`;
  if (row.plaintext !== undefined || row.decryptFailed) return `/${threadHrefFor(undefined)}`;
  return undefined;
}

/** The message and the stored messages its `re` chain runs through, nearest first. */
async function chainOf(txid: string): Promise<MessageRow[]> {
  const chain: MessageRow[] = [];
  let next: string | undefined = txid;
  while (next !== undefined && chain.length < MAX_CHAIN) {
    const row: MessageRow | undefined = await messagesRepo.getByTxid(next);
    if (!row || chain.some((seen) => seen.txid === row.txid)) break;
    chain.push(row);
    next = repliedTo(row);
  }
  return chain;
}

/** Where a tap on a notification with this data opens: the message's thread when
 * the phone already holds it decrypted (a reply opens its post's reply thread),
 * else the URL the push was built with. A push carries no plaintext, so a message
 * not yet here lands on the notice screen, which does the same once it arrives. */
export async function resolveTapUrl(data: TapData | undefined): Promise<string> {
  if (data?.txid) {
    const chain = await chainOf(data.txid);
    const thread = threadUrlOfMessage(chain[0], chain);
    if (thread) return thread;
  }
  return data?.url ?? (data?.class ? CLASS_URLS[data.class] : undefined) ?? '/?v=needs';
}
