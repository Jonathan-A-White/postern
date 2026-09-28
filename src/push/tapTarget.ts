// src/push/tapTarget.ts — where a tap on a push notification lands (mw-f758y.25).
// A push about a record carries its txid and class, never its plaintext, so the
// thread it belongs to is only known once the phone has that message decrypted.
// Imported by src/sw.ts's notificationclick handler (which asks the same IndexedDB
// the app writes) and by the notice screen the tap otherwise lands on.
import type { MessageClass, MessageRow } from '../data/db';
import { messagesRepo } from '../data/repositories/messages-repo';
import { threadHrefFor } from '../nav/route';
import { CLASS_URLS } from './classOptions';

export interface TapData {
  txid?: string;
  class?: MessageClass;
  url?: string;
}

/** The thread's URL for a message the phone has already decrypted (or given up
 * on: the general thread), or undefined while its thread is still unknown. */
export function threadUrlOfMessage(row: MessageRow | undefined): string | undefined {
  if (!row) return undefined;
  if (row.thread) return `/${threadHrefFor(row.thread)}`;
  if (row.plaintext !== undefined || row.decryptFailed) return `/${threadHrefFor(undefined)}`;
  return undefined;
}

/** Where a tap on a notification with this data opens: the message's thread when
 * the phone already holds it decrypted, else the URL the push was built with. */
export async function resolveTapUrl(data: TapData | undefined): Promise<string> {
  if (data?.txid) {
    const thread = threadUrlOfMessage(await messagesRepo.getByTxid(data.txid));
    if (thread) return thread;
  }
  return data?.url ?? (data?.class ? CLASS_URLS[data.class] : undefined) ?? '/?v=needs';
}
