// src/services/chainRead.ts — the phone reading the anchor address itself (docs/protocol.md §21),
// for the time the backend cannot be reached: the address's recent history from WhatsOnChain, each
// transaction's raw hex, the postern record in it, and the same decrypt and store the backend's
// feed goes through (inbox.ts). A record kept here is found again by the backend's own sync later
// under the same `txid:vout`, so nothing is shown twice. An `events` record (§22) is no message:
// its batch is handed back, decrypted, for the same projector the backend's feed goes through.
import { Transaction, Utils } from '@bsv/sdk';
import { chainConfig, decodeRecordScript } from 'spell-forge-bsv';
import type { MessageRow } from '../data/db';
import type { EventBatch } from '../model/events';
import { eventBatchOf, isMessagePayload, storeRecord } from './inbox';
import { ANCHOR_ADDRESS, type MessagePayload } from './messages';
import { messagesRepo } from '../data/repositories';

/** How often the phone reads the chain while the backend is out of reach: often enough that the queue (§22) keeps flowing, rarely enough for WhatsOnChain's free tier. */
export const CHAIN_POLL_MS = 5_000;

/** The longest the phone waits between reads: each read that fails (an error, a 429) doubles the wait up to this, a clean read brings it back to CHAIN_POLL_MS. */
export const CHAIN_MAX_BACKOFF_MS = 60_000;

/** The wait before the next chain read: doubled (to the cap) after a read that failed, back to the base after a clean one. */
export function nextChainDelay(current: number, clean: boolean): number {
  return clean ? CHAIN_POLL_MS : Math.min(current * 2, CHAIN_MAX_BACKOFF_MS);
}

/** WhatsOnChain's free tier allows about 3 requests a second: the hex fetches of one read are spaced this far apart (about 2 a second). */
export const HEX_GAP_MS = 500;

/** The most transactions one read fetches the hex of, newest first (about 2 a second over one poll): a long history is caught up over several reads, never in one burst at WhatsOnChain. */
export const MAX_TXS_PER_READ = 10;

/** A row kept from the chain has no backend sequence number yet; the backend's own sync replaces this. */
const NO_SEQ = Number.MAX_SAFE_INTEGER;

interface HistoryEntry {
  tx_hash: string;
  height?: number;
}

async function historyPage(url: string, fetchImpl: typeof fetch, missingIsEmpty: boolean): Promise<HistoryEntry[]> {
  const response = await fetchImpl(url);
  if (response.status === 404 && missingIsEmpty) return [];
  if (!response.ok) throw new Error(`WhatsOnChain could not list the anchor address's history (it answered ${response.status}).`);
  const body = (await response.json().catch(() => undefined)) as { result?: unknown } | unknown[] | undefined;
  const list = Array.isArray(body) ? body : body?.result;
  if (!Array.isArray(list)) throw new Error("WhatsOnChain answered the anchor address's history with something that is not a list.");
  return list as HistoryEntry[];
}

/**
 * The anchor address's newest transaction ids, newest first, each once: the unconfirmed ones
 * (height 0), then the newest page of confirmed ones by height. A ring is recent, so only the
 * first page is read; WhatsOnChain answers a 404 for an address it has never seen.
 */
export async function fetchAnchorHistory(address: string = ANCHOR_ADDRESS, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const base = `${chainConfig.providerBaseUrl}/address/${address}`;
  // Unconfirmed first, so a transaction that confirms between the two reads shows in both rather than in neither.
  const unconfirmed = await historyPage(`${base}/unconfirmed/history`, fetchImpl, false);
  const confirmed = await historyPage(`${base}/confirmed/history`, fetchImpl, true);
  const newestFirst = [...confirmed].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const ids = [...unconfirmed, ...newestFirst].map((entry) => entry.tx_hash).filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)];
}

/** WhatsOnChain refused or failed a request; `status` 429 means the free tier's limit was reached, so the read stops asking. */
export class ChainBusyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** One transaction's raw hex from WhatsOnChain. */
export async function fetchRawTransaction(txid: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${chainConfig.providerBaseUrl}/tx/${txid}/hex`);
  if (!response.ok) throw new ChainBusyError(`WhatsOnChain could not give transaction ${txid.slice(0, 8)}… (it answered ${response.status}).`, response.status);
  return (await response.text()).trim();
}

/** The postern records a raw transaction carries, by output number; anything that is not one (a payment, a foreign OP_RETURN, garbage) is skipped. */
export function recordsInTransaction(rawHex: string): { vout: number; payload: MessagePayload }[] {
  let tx: Transaction;
  try {
    tx = Transaction.fromHex(rawHex);
  } catch {
    return [];
  }
  const found: { vout: number; payload: MessagePayload }[] = [];
  tx.outputs.forEach((output, vout) => {
    const decoded = decodeRecordScript(output.lockingScript);
    if (!decoded || decoded.version !== 1) return;
    try {
      const payload: unknown = JSON.parse(Utils.toUTF8(decoded.payloadBytes));
      if (isMessagePayload(payload)) found.push({ vout, payload });
    } catch {
      // a record whose payload is not postern's JSON
    }
  });
  return found;
}

export interface ReadChainParams {
  /** This phone's own public key (hex). */
  publicKeyHex: string;
  unlockedKey: Uint8Array;
  /** The pinned Mayor (§15): the one key whose events records (§22) are read. */
  mayorKey?: string;
  /** The transactions already read this session: each is fetched once. A transaction that failed to read is left out of it, so the next read tries again. */
  seen: Set<string>;
  address?: string;
  fetchImpl?: typeof fetch;
  /** The wait between two hex fetches of the read (default HEX_GAP_MS); tests pass 0. */
  hexGapMs?: number;
  /** Stops the read between two transactions. */
  signal?: AbortSignal;
}

export interface ChainRead {
  /** The messages that were new: not already on this phone from the backend or an earlier read. */
  rows: MessageRow[];
  /** The events batches (§22) found in transactions not read before, sent by the pinned Mayor to this phone. */
  events: EventBatch[];
  /** How many transactions could not be read this time (WhatsOnChain failed or refused, or a record could not be stored): they stay unseen and the next read asks again. The caller backs off when this is not 0. */
  failed: number;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/**
 * Reads the anchor address's recent history and keeps every record in a transaction not yet
 * `seen` that names this phone, decrypted. Resolves with the rows that were new (not already on
 * this phone from the backend or an earlier read) and the events batches found; throws if
 * WhatsOnChain cannot list the history. At most MAX_TXS_PER_READ transactions are fetched, a gap
 * apart. A transaction is `seen` only once its records are applied (or none is ours): one that
 * fails is counted in `failed` and left unseen for the next read, and never costs the others
 * of this read; a 429 ends the read there.
 */
export async function readChain(params: ReadChainParams): Promise<ChainRead> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const gap = params.hexGapMs ?? HEX_GAP_MS;
  const unlockedKeyHex = Utils.toHex(Array.from(params.unlockedKey));
  const history = await fetchAnchorHistory(params.address, fetchImpl);
  const read: ChainRead = { rows: [], events: [], failed: 0 };
  let fetched = 0;
  for (const txid of history.filter((id) => !params.seen.has(id)).slice(0, MAX_TXS_PER_READ)) {
    if (params.signal?.aborted) break;
    if (fetched > 0) await pause(gap, params.signal);
    if (params.signal?.aborted) break;
    fetched += 1;
    try {
      const records = recordsInTransaction(await fetchRawTransaction(txid, fetchImpl));
      for (const record of records) {
        if (record.payload.class === 'events') {
          const batch = eventBatchOf(record.payload, params, unlockedKeyHex);
          if (batch) read.events.push(batch);
          continue;
        }
        if (await messagesRepo.get(`${txid}:${record.vout}`)) continue;
        const row = await storeRecord({ seq: NO_SEQ, txid, vout: record.vout, payload: record.payload }, params.publicKeyHex, unlockedKeyHex);
        if (row) read.rows.push(row);
      }
      params.seen.add(txid);
    } catch (err) {
      read.failed += 1;
      if (err instanceof ChainBusyError && err.status === 429) break;
    }
  }
  return read;
}
