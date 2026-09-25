// src/services/inbox.ts — fetches new records from GET /api/messages (docs/api.md),
// keeps only records naming this key as `to` or `from` (docs/protocol.md), decrypts
// what the unlocked key can, and advances the stored cursor so a repeat sync never
// re-fetches what's already indexed.
import { Utils } from '@bsv/sdk';
import { messagesRepo, settingsRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { API_BASE, decryptMessage, decryptMessageAsSender, type MessagePayload } from './messages';

const CURSOR_SETTING_KEY = 'messages-cursor';

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload?: unknown;
}

interface ApiResponse {
  records: ApiRecord[];
  next: number;
}

function isMessagePayload(payload: unknown): payload is MessagePayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.kind === 'msg' &&
    typeof p.class === 'string' &&
    typeof p.to === 'string' &&
    typeof p.from === 'string' &&
    typeof p.ts === 'number' &&
    typeof p.ct === 'string'
  );
}

function keyToHex(key: Uint8Array): string {
  return Utils.toHex(Array.from(key));
}

/** Decrypts a payload with the unlocked key: as the recipient for a received
 * message, or as the sender for a message this phone sent (mw-1589l.27) — the
 * same shared key either side of a message can derive (docs/protocol.md §2). */
function tryDecrypt(
  payload: MessagePayload,
  unlockedKeyHex: string,
  direction: MessageRow['direction'],
): Pick<MessageRow, 'plaintext' | 'decryptFailed'> {
  try {
    const plaintext =
      direction === 'sent' ? decryptMessageAsSender(payload, unlockedKeyHex) : decryptMessage(payload, unlockedKeyHex);
    return { plaintext };
  } catch {
    return { decryptFailed: true };
  }
}

/** Retries decrypting every stored, not-yet-decrypted message (received or sent)
 * with the given unlocked key — for the case the key is unlocked after messages
 * were already synced while it was locked. */
export async function decryptPendingMessages(unlockedKey: Uint8Array): Promise<void> {
  const unlockedKeyHex = keyToHex(unlockedKey);
  const rows = await messagesRepo.getAll();
  for (const row of rows) {
    if (row.plaintext !== undefined || row.decryptFailed) continue;
    const payload: MessagePayload = { v: 1, kind: 'msg', class: row.class, to: row.to, from: row.from, ts: row.ts, ct: row.ciphertext };
    await messagesRepo.put({ ...row, ...tryDecrypt(payload, unlockedKeyHex, row.direction) });
  }
}

export interface SyncMessagesParams {
  /** This phone's own public key (hex) — the vault row's publicKeyHex. */
  publicKeyHex: string;
  /** Passed once the key is unlocked, so a received message can be decrypted as it arrives. */
  unlockedKey?: Uint8Array;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches every record newer than the stored cursor, keeps the ones naming this
 * key as sender or recipient, decrypts what the unlocked key can, and advances the
 * cursor to the backend's new head. Throws (leaving the cursor and stored rows
 * untouched) if the fetch itself fails — an offline caller should catch and fall
 * back to messagesRepo.getAll() for what's already stored.
 */
export async function syncMessages(params: SyncMessagesParams): Promise<void> {
  const apiBase = params.apiBase ?? API_BASE;
  const fetchImpl = params.fetchImpl ?? fetch;
  const unlockedKeyHex = params.unlockedKey ? keyToHex(params.unlockedKey) : undefined;

  const since = ((await settingsRepo.get(CURSOR_SETTING_KEY)) as number | undefined) ?? 0;
  const response = await fetchImpl(`${apiBase}/messages?since=${since}`);
  if (!response.ok) throw new Error(`Could not fetch messages (${response.status}).`);
  const body = (await response.json()) as ApiResponse;

  for (const record of body.records ?? []) {
    if (!isMessagePayload(record.payload)) continue;
    const payload = record.payload;
    const isToMe = payload.to === params.publicKeyHex;
    const isFromMe = payload.from === params.publicKeyHex;
    if (!isToMe && !isFromMe) continue;

    const id = `${record.txid}:${record.vout}`;
    const existing = await messagesRepo.get(id);
    const direction: MessageRow['direction'] = isFromMe ? 'sent' : 'received';

    const decrypted = unlockedKeyHex ? tryDecrypt(payload, unlockedKeyHex, direction) : {};

    await messagesRepo.put({
      id,
      txid: record.txid,
      vout: record.vout,
      seq: record.seq,
      class: payload.class,
      to: payload.to,
      from: payload.from,
      ts: payload.ts,
      ciphertext: payload.ct,
      plaintext: existing?.plaintext ?? decrypted.plaintext,
      decryptFailed: existing?.decryptFailed ?? decrypted.decryptFailed,
      direction,
      read: existing?.read ?? false,
    });
  }

  await settingsRepo.set(CURSOR_SETTING_KEY, body.next);

  if (params.unlockedKey) {
    await decryptPendingMessages(params.unlockedKey);
  }
}
