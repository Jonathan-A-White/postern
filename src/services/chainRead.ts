// src/services/chainRead.ts — the phone reading the anchor address itself (docs/protocol.md §21),
// for the time the backend cannot be reached: the address's recent history from WhatsOnChain, each
// transaction's raw hex, the postern record in it, and the same decrypt and store the backend's
// feed goes through (inbox.ts). A record kept here is found again by the backend's own sync later
// under the same `txid:vout`, so nothing is shown twice.
import { Transaction, Utils } from '@bsv/sdk';
import { chainConfig, decodeRecordScript } from 'spell-forge-bsv';
import type { MessageRow } from '../data/db';
import { isMessagePayload, storeRecord } from './inbox';
import { ANCHOR_ADDRESS, type MessagePayload } from './messages';
import { messagesRepo } from '../data/repositories';

/** How often the phone reads the chain while the backend is out of reach. */
export const CHAIN_POLL_MS = 30_000;

/** The most transactions one read fetches the hex of, newest first: a long history is caught up over several reads, never in one burst at WhatsOnChain. */
export const MAX_TXS_PER_READ = 20;

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

/** One transaction's raw hex from WhatsOnChain. */
export async function fetchRawTransaction(txid: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${chainConfig.providerBaseUrl}/tx/${txid}/hex`);
  if (!response.ok) throw new Error(`WhatsOnChain could not give transaction ${txid.slice(0, 8)}… (it answered ${response.status}).`);
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
  /** The transactions already read this session: each is fetched once. A transaction that failed to read is left out of it, so the next read tries again. */
  seen: Set<string>;
  address?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the anchor address's recent history and keeps every record in a transaction not yet
 * `seen` that names this phone, decrypted. Resolves with the rows that were new (not already on
 * this phone from the backend or an earlier read); throws if WhatsOnChain cannot be reached.
 */
export async function readChain(params: ReadChainParams): Promise<MessageRow[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const unlockedKeyHex = Utils.toHex(Array.from(params.unlockedKey));
  const history = await fetchAnchorHistory(params.address, fetchImpl);
  const fresh: MessageRow[] = [];
  for (const txid of history.filter((id) => !params.seen.has(id)).slice(0, MAX_TXS_PER_READ)) {
    const records = recordsInTransaction(await fetchRawTransaction(txid, fetchImpl));
    for (const record of records) {
      if (await messagesRepo.get(`${txid}:${record.vout}`)) continue;
      const row = await storeRecord({ seq: NO_SEQ, txid, vout: record.vout, payload: record.payload }, params.publicKeyHex, unlockedKeyHex);
      if (row) fresh.push(row);
    }
    params.seen.add(txid);
  }
  return fresh;
}
