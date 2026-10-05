// src/services/stamp.ts — reading a chain stamp back (millwright docs/chain-stamps.md): a landing leaves a record on
// the chain whose clear part is a commitment, SHA-256(rig + "\n" + commit), and whose sealed `ct` holds the rig and
// commit again with the story. The bead page finds the stamp in the bead's `STAMP <txid> for <commit> (testnet)`
// comment, fetches the transaction, and says whether it checks out: the commitment is this commit's, and the body,
// opened with his key, names the same rig and commit.
import { Transaction, Utils } from '@bsv/sdk';
import { chainConfig, decodeRecordScript } from 'spell-forge-bsv';
import type { BeadComment } from '../model/view';
import { ChainBusyError, HEX_GAP_MS, fetchRawTransaction } from './chainRead';
import { decryptMessage } from './messages';

export interface StampRef {
  txid: string;
  commit: string;
}

export type StampStatus = 'checks-out' | 'mismatch' | 'not-found' | 'unreachable' | 'locked';

export interface StampResult {
  status: StampStatus;
  /** Unix seconds of the block; null while the transaction is in the mempool; undefined when WhatsOnChain could not say. */
  blockTime?: number | null;
  /** What he is told, in plain words. */
  reason: string;
}

/** What the check needs of WhatsOnChain: tests give a fake, the app gives `wocStampChain`. */
export interface StampChain {
  /** The raw hex of a transaction; rejects with a `status` of 404 when WhatsOnChain does not know it. */
  rawHex(txid: string): Promise<string>;
  /** The unix seconds of the block that holds it, or null while it is in the mempool. */
  blockTime(txid: string): Promise<number | null>;
}

const STAMP_COMMENT = /^STAMP ([0-9a-f]{64}) for ([0-9a-f]+) \(testnet\)/m;

/** The stamps a bead's comments name, in order, each txid once. */
export function parseStampComments(comments: readonly Pick<BeadComment, 'text'>[]): StampRef[] {
  const found = new Map<string, StampRef>();
  for (const comment of comments) {
    const match = STAMP_COMMENT.exec(comment.text.trimStart());
    if (match && !found.has(match[1])) found.set(match[1], { txid: match[1], commit: match[2] });
  }
  return [...found.values()];
}

/** The stamp's public handle: lower-case hex SHA-256 of the rig, a newline and the commit id. */
export async function commitmentOf(rig: string, commit: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(Utils.toArray(`${rig}\n${commit}`, 'utf8')));
  return Utils.toHex(Array.from(new Uint8Array(digest)));
}

export function explorerUrl(txid: string): string {
  return `https://test.whatsonchain.com/tx/${txid}`;
}

/** WhatsOnChain's free tier allows about 3 requests a second: the requests of every stamp check start at least this far apart. */
export const stampLimiter = { gapMs: HEX_GAP_MS };

let queue: Promise<unknown> = Promise.resolve();
let lastStart = 0;

function limited<T>(run: () => Promise<T>): Promise<T> {
  const turn = queue.then(async () => {
    const wait = lastStart + stampLimiter.gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastStart = Date.now();
    return run();
  });
  queue = turn.catch(() => undefined);
  return turn;
}

/** The testnet WhatsOnChain, each request through the limiter. */
export function wocStampChain(fetchImpl?: typeof fetch): StampChain {
  const call = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    rawHex: (txid) => limited(() => fetchRawTransaction(txid, call)),
    blockTime: (txid) =>
      limited(async () => {
        const response = await call(`${chainConfig.providerBaseUrl}/tx/hash/${txid}`);
        if (!response.ok) throw new ChainBusyError(`WhatsOnChain gave no info for ${txid.slice(0, 8)}… (it answered ${response.status}).`, response.status);
        const info = (await response.json()) as { blocktime?: unknown };
        return typeof info.blocktime === 'number' && info.blocktime > 0 ? info.blocktime : null;
      }),
  };
}

interface StampRecord {
  commitment: string;
  ct: string;
}

/** The stamp record in output 0 of a raw transaction, or undefined when it carries none. */
function stampRecordOf(rawHex: string): StampRecord | undefined {
  try {
    const decoded = decodeRecordScript(Transaction.fromHex(rawHex).outputs[0].lockingScript);
    if (!decoded || decoded.version !== 1) return undefined;
    const payload = JSON.parse(Utils.toUTF8(decoded.payloadBytes)) as Record<string, unknown>;
    if (payload.kind !== 'stamp' || typeof payload.commitment !== 'string' || typeof payload.ct !== 'string') return undefined;
    return { commitment: payload.commitment, ct: payload.ct };
  } catch {
    return undefined;
  }
}

const SEALED_MISMATCH = 'The sealed part names a different rig or commit';

/** The rig and commit inside a sealed body opened with `key`, or undefined when it will not open or is not a stamp body. */
function openedBody(record: StampRecord, key: Uint8Array): { rig?: unknown; commit?: unknown } | undefined {
  try {
    // decryptMessage reads only `ct`: the rest of a message's envelope is for the message path.
    const text = decryptMessage({ v: 1, kind: 'msg', class: 'message', to: '', from: '', ts: 0, ct: record.ct }, Utils.toHex(Array.from(key)));
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null ? (body as { rig?: unknown; commit?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the stamp `txid` checks out for `rig` and `commit`: the transaction's output 0 is a stamp record, its
 * commitment is commitmentOf(rig, commit), and its sealed body, opened with `key`, names the same rig and commit.
 * Without a key the commitment is still compared, and a stamp that passes says it is locked, not that it checks out.
 */
export async function verifyStamp(stamp: { txid: string; rig: string; commit: string }, chain: StampChain, key: Uint8Array | null): Promise<StampResult> {
  let hex: string;
  try {
    hex = await chain.rawHex(stamp.txid);
  } catch (err) {
    const notFound = (err as { status?: unknown } | null)?.status === 404;
    return notFound ? { status: 'not-found', reason: 'WhatsOnChain does not know this transaction' } : { status: 'unreachable', reason: 'Could not reach WhatsOnChain' };
  }
  // The block time is a nicety: a failure to read it never changes the answer.
  const blockTime = await chain.blockTime(stamp.txid).catch(() => undefined);

  const record = stampRecordOf(hex);
  if (!record) return { status: 'mismatch', blockTime, reason: 'That transaction is not a chain stamp' };
  if (record.commitment.toLowerCase() !== (await commitmentOf(stamp.rig, stamp.commit))) {
    return { status: 'mismatch', blockTime, reason: 'The commitment on chain does not match this commit' };
  }
  if (!key) {
    return { status: 'locked', blockTime, reason: 'Unlock your key to open the sealed part. The commitment on chain matches this commit.' };
  }
  const body = openedBody(record, key);
  if (!body) return { status: 'mismatch', blockTime, reason: 'The sealed part could not be opened with your key' };
  if (body.rig !== stamp.rig || body.commit !== stamp.commit) return { status: 'mismatch', blockTime, reason: SEALED_MISMATCH };
  return { status: 'checks-out', blockTime, reason: 'Checks out' };
}
