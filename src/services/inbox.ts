// src/services/inbox.ts — fetches new records from GET /api/messages (docs/api.md),
// keeps only records naming this key as `to` or `from` (docs/protocol.md), decrypts
// what the unlocked key can, and advances the stored cursor so a repeat sync never
// re-fetches what's already indexed.
import { Utils } from '@bsv/sdk';
import { messagesRepo, settingsRepo } from '../data/repositories';
import type { MessageRow } from '../data/db';
import { apiFetch } from './apiAuth';
import { decryptMessage, decryptMessageAsSender, type MessagePayload } from './messages';
import { threadKey, threadOf } from './threads';
import { decodeEventBatch, type EventBatch } from '../model/events';

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

export function isMessagePayload(payload: unknown): payload is MessagePayload {
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
    const decrypted = tryDecrypt(payload, unlockedKeyHex, row.direction);
    await messagesRepo.put({ ...row, ...decrypted, thread: threadKey(threadOf(row.class, decrypted.plaintext)) });
  }
}

export interface RecordToStore {
  seq: number;
  txid: string;
  vout: number;
  payload: MessagePayload;
}

/**
 * Keeps one record that names this key as sender or recipient, decrypted if the key is
 * unlocked, under its outpoint (`txid:vout`). A row already kept is updated in place, never
 * duplicated. Resolves with the row, or `undefined` for a record that names neither side.
 * Shared by the backend's feed (syncMessages) and the phone's own read of the chain
 * (docs/protocol.md §21).
 */
export async function storeRecord(record: RecordToStore, publicKeyHex: string, unlockedKeyHex?: string): Promise<MessageRow | undefined> {
  const payload = record.payload;
  // An events batch (§22) is no message: syncMessages hands it to the projector instead.
  if (payload.class === 'events') return undefined;
  const isToMe = payload.to === publicKeyHex;
  const isFromMe = payload.from === publicKeyHex;
  if (!isToMe && !isFromMe) return undefined;

  const id = `${record.txid}:${record.vout}`;
  const existing = await messagesRepo.get(id);
  const direction: MessageRow['direction'] = isFromMe ? 'sent' : 'received';

  const decrypted = unlockedKeyHex ? tryDecrypt(payload, unlockedKeyHex, direction) : {};
  const plaintext = existing?.plaintext ?? decrypted.plaintext;

  const row: MessageRow = {
    id,
    txid: record.txid,
    vout: record.vout,
    seq: record.seq,
    class: payload.class,
    to: payload.to,
    from: payload.from,
    ts: payload.ts,
    ciphertext: payload.ct,
    plaintext,
    decryptFailed: existing?.decryptFailed ?? decrypted.decryptFailed,
    direction,
    // A Talk turn or a call record is never unread: it is heard on the Talk line, not counted (§20, §21).
    read: existing?.read ?? (payload.class === 'talk' || payload.class === 'call'),
    thread: existing?.thread ?? threadKey(threadOf(payload.class, plaintext)),
  };
  await messagesRepo.put(row);
  return row;
}

export interface SyncMessagesParams {
  /** This phone's own public key (hex) — the vault row's publicKeyHex. */
  publicKeyHex: string;
  /** Passed once the key is unlocked, so a received message can be decrypted as it arrives. */
  unlockedKey?: Uint8Array;
  /** The pinned Mayor (§15): the one key whose events records (§22) are read. */
  mayorKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncMessagesResult {
  /** The events batches (§22) this page held, decrypted, sent by the pinned Mayor to this key. */
  events: EventBatch[];
}

/** An events record's batch, when it is the pinned Mayor's to this key and decrypts and parses; else undefined.
 * Shared by the backend's feed and the phone's own read of the chain (§21, §22). */
export function eventBatchOf(payload: MessagePayload, params: Pick<SyncMessagesParams, 'publicKeyHex' | 'mayorKey'>, unlockedKeyHex: string | undefined): EventBatch | undefined {
  if (!unlockedKeyHex || !params.mayorKey || payload.from !== params.mayorKey || payload.to !== params.publicKeyHex) return undefined;
  try {
    return decodeEventBatch(decryptMessage(payload, unlockedKeyHex));
  } catch {
    return undefined;
  }
}

/**
 * Fetches every record newer than the stored cursor, keeps the ones naming this
 * key as sender or recipient, decrypts what the unlocked key can, and advances the
 * cursor to the backend's new head. An events record is not kept as a message: its
 * batch is handed back for src/services/events.ts to project. Throws (leaving the cursor and stored rows
 * untouched) if the fetch itself fails — an offline caller should catch and fall
 * back to messagesRepo.getAll() for what's already stored.
 */
export async function syncMessages(params: SyncMessagesParams): Promise<SyncMessagesResult> {
  const unlockedKeyHex = params.unlockedKey ? keyToHex(params.unlockedKey) : undefined;

  const since = ((await settingsRepo.get(CURSOR_SETTING_KEY)) as number | undefined) ?? 0;
  const response = await apiFetch(`/messages?since=${since}`, undefined, {
    unlockedKey: params.unlockedKey,
    apiBase: params.apiBase,
    fetchImpl: params.fetchImpl,
  });
  if (!response.ok) throw new Error(`Could not fetch messages (${response.status}).`);
  const body = (await response.json()) as ApiResponse;

  const events: EventBatch[] = [];
  for (const record of body.records ?? []) {
    if (!isMessagePayload(record.payload)) continue;
    if (record.payload.class === 'events') {
      const batch = eventBatchOf(record.payload, params, unlockedKeyHex);
      if (batch) events.push(batch);
      continue;
    }
    await storeRecord({ seq: record.seq, txid: record.txid, vout: record.vout, payload: record.payload }, params.publicKeyHex, unlockedKeyHex);
  }

  await settingsRepo.set(CURSOR_SETTING_KEY, body.next);

  if (params.unlockedKey) {
    await decryptPendingMessages(params.unlockedKey);
  }
  return { events };
}
