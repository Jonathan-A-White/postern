// src/model/outbox.ts — what the screens read off the outgoing queue (mw-jrx0s.10): which
// card, bubble or turn still waits to go, the one-line note for the status line, and how
// long a failed send waits before its next try. Pure: the rows are src/data/db.ts's OutboxRow.
import type { MessageRow, OutboxRow } from '../data/db';
import { namesCard } from '../services/questions';
import type { ConversationItem } from './conversation';

/** The one line the status line shows while anything he did has not yet gone. */
export const SENDING_WHEN_BACK = 'Sending when back online';

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** How long a row waits for its next try after `attempts` failures (2 s, 4 s, 8 s … at most a minute). */
export function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** How long a Talk turn that went on the chain holds back the turns he spoke after it, waiting for its record to be seen (the poller reads the chain every 5 s; a minute is generous), before they go on without it. */
export const CHAIN_HOLD_MS = 2 * 60 * 1000;

/** How often the sender looks again while a turn waits on a turn that went on the chain. */
export const CHAIN_HOLD_LOOK_MS = 5_000;

/** Whether a Talk turn that was refused, or put on the chain and not yet seen, holds the later turn back (mw-q6n8m0.12): `earlier` is the turns written before it, oldest first, `now` ms since the epoch. A failed one holds it until he taps Retry or Discard; one on the chain holds it until its record is seen (it is then acked) or CHAIN_HOLD_MS has passed. */
export function turnHeldBy(earlier: OutboxRow[], now: number): { reason: 'refused' | 'chain'; lookAt?: number } | undefined {
  if (earlier.some((row) => row.state === 'failed')) return { reason: 'refused' };
  // A row an older build sent has no sentAt and holds nothing.
  const onChain = earlier.find((row) => row.state === 'sent' && row.txid !== undefined && !row.txid.startsWith('direct:') && row.sentAt !== undefined && now - row.sentAt < CHAIN_HOLD_MS);
  if (onChain) return { reason: 'chain', lookAt: Math.min(now + CHAIN_HOLD_LOOK_MS, (onChain.sentAt as number) + CHAIN_HOLD_MS) };
  return undefined;
}

/** Whether the row has not yet been taken by a backend or the chain. */
export function isPending(row: OutboxRow): boolean {
  return row.state === 'pending';
}

/** Whether the row has not gone and is still his to settle: waiting to go, or refused and waiting for Retry or Discard (mw-jrx0s.21). */
export function isUnsent(row: OutboxRow): boolean {
  return row.state === 'pending' || row.state === 'failed';
}

/** His answer to a question on `bead` asked at `sinceMs` that has not yet gone. An answer that names a card
 * (its `re`) is pending for that card only: `re` is the txid of the card asking, when it has one. */
export function pendingAnswer(rows: OutboxRow[], bead: string, sinceMs: number, re?: string): OutboxRow | undefined {
  return rows.find((row) => row.kind === 'answer' && row.bead === bead && isUnsent(row) && row.created >= sinceMs && namesCard(row.payload.re, re));
}

/** His one-tap `action` on `bead` that has not yet gone: an action row, or a message that settles it (Verified's channel message). */
export function pendingAction(rows: OutboxRow[], bead: string, action: string): OutboxRow | undefined {
  return rows.find(
    (row) =>
      row.bead === bead &&
      isUnsent(row) &&
      ((row.kind === 'action' && (row.payload.action as { action?: string } | undefined)?.action === action) || (row.kind === 'message' && row.payload.settles === action)),
  );
}

/** His Talk turn `talkId`/`turn` that has not yet gone. */
export function pendingTurn(rows: OutboxRow[], talkId: string, turn: number): OutboxRow | undefined {
  return rows.find((row) => {
    const sent = row.payload.turn as { talk?: { id?: string; turn?: number } } | undefined;
    return row.kind === 'turn' && isUnsent(row) && sent?.talk?.id === talkId && sent.talk.turn === turn;
  });
}

/** Whether anything he did is waiting for the backend or the chain to come back: a row whose first try has failed. */
export function anyPending(rows: OutboxRow[]): boolean {
  return rows.some((row) => isPending(row) && row.attempts > 0);
}

/** How many failed tries a row has before the phone tells the backend's journal about it, and how often it says so again (mw-o14xubc). */
export const REPORT_AFTER_ATTEMPTS = 3;
export const REPORT_EVERY_MS = 60 * 60 * 1000;

/** Whether a row that has just failed its `attempts`th try is reported to the backend now (mw-o14xubc): after REPORT_AFTER_ATTEMPTS tries, at most once a row every REPORT_EVERY_MS. */
export function shouldReportFailure(row: Pick<OutboxRow, 'attempts' | 'reportedAt'>, now: number): boolean {
  if (row.attempts < REPORT_AFTER_ATTEMPTS) return false;
  return row.reportedAt === undefined || now - row.reportedAt >= REPORT_EVERY_MS;
}

/** How long the reason after 'Retrying in N s:' may run. */
const SHORT_REASON_CHARS = 60;

/** `words` as the status line has room for: the first sentence, cut at a word to SHORT_REASON_CHARS with an ellipsis. */
export function shortReason(words: string): string {
  const sentence = (/^(.*?[.!?])(?:\s|$)/.exec(words.trim())?.[1] ?? words.trim()).replace(/[.!?]$/, '');
  if (sentence.length <= SHORT_REASON_CHARS) return sentence;
  const cut = sentence.slice(0, SHORT_REASON_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).trimEnd()}…`;
}

/** Lines the status line shows while the phone reaches the backend (mw-gb92lmo): what truly holds the row. */
export const SENDING_NOW = 'Sending…';
export const REFUSED_LINE = 'Not sent: the backend refused it. Tap Retry or Discard.';
export const HELD_BY_REFUSED_LINE = 'Waiting on an earlier turn that was refused: tap Retry or Discard on it';
export const HELD_BY_CHAIN_LINE = 'Waiting on an earlier turn to be seen';
export const WAITING_FOR_KEY_LINE = "Waiting for the Mayor's key before sending";

/** The one line the status line shows, or undefined for none. `reachable` is whether the phone reaches the backend (live.ts's
 * backendReachable: the stream is open, it is polled, or the backend answers its syncs and probes though the stream is down,
 * mw-j4usch0): then a row is never said to wait for the phone to be back online, and the line names what holds it, from the
 * row's own state: a refused row (Retry or Discard), a turn waiting on an earlier one, the wait before the next
 * try, a try under way, the key still unknown. Out of reach, a row whose first try has failed says it will go when back online. */
export function outboxLine(rows: OutboxRow[], now: number, reachable: boolean): string | undefined {
  if (!reachable) return anyPending(rows) ? SENDING_WHEN_BACK : undefined;
  const turns = rows.filter((row) => row.kind === 'turn' && row.state !== 'acked');
  for (const row of turns.filter(isPending)) {
    const held = turnHeldBy(turns.filter((earlier) => (earlier.id ?? 0) < (row.id ?? 0)), now);
    if (held) return held.reason === 'refused' ? HELD_BY_REFUSED_LINE : HELD_BY_CHAIN_LINE;
  }
  if (rows.some((row) => row.state === 'failed')) return REFUSED_LINE;
  const tried = rows.find((row) => isPending(row) && row.attempts > 0);
  if (!tried) return undefined;
  if (tried.nextAt === undefined) return WAITING_FOR_KEY_LINE;
  if (tried.nextAt <= now) return SENDING_NOW;
  // The wait names what the last try failed on (mw-o14xubc), so a row that fails every try is never a bare countdown.
  const reason = tried.note ? `: ${shortReason(tried.note)}` : '';
  return `Retrying in ${Math.ceil((tried.nextAt - now) / 1000)} s${reason}`;
}

/** The words a message waiting to go shows: its text, and the names of the files that go with it. */
function messageWords(row: OutboxRow): string {
  const text = typeof row.payload.text === 'string' ? row.payload.text : '';
  const files = Array.isArray(row.payload.files) ? (row.payload.files as { name?: string }[]).map((file) => file.name ?? 'file') : [];
  return files.length === 0 ? text : `${text}${text ? '\n\n' : ''}_Files: ${files.join(', ')}_`;
}

/**
 * His messages that are on their way as bubbles of his own, newest last: a pending one, and one a
 * backend took whose own record this phone has not yet kept (`have` holds the kept records).
 * `inThread` says which threads to show them under (a thread key, undefined being the general thread).
 */
export function pendingMessageItems(rows: OutboxRow[], have: MessageRow[], inThread: (thread: string | undefined) => boolean): ConversationItem[] {
  const kept = new Set(have.map((row) => row.txid));
  return rows
    .filter((row) => row.kind === 'message' && row.state !== 'acked' && inThread(row.thread) && !(row.txid && kept.has(row.txid)))
    .map((row) => ({
      id: `outbox:${row.id}`,
      at: row.created,
      speaker: 'you' as const,
      speakerLabel: 'You',
      kind: 'text' as const,
      text: messageWords(row),
      pending: true,
      source: 'message' as const,
      outboxId: row.id as number,
      ...(row.state === 'failed' ? { failure: row.failure ?? 'The backend refused it.' } : {}),
      ...(row.state === 'pending' && row.note ? { note: row.note } : {}),
      ...(row.recorded ? { recorded: row.recorded } : {}),
      ...(row.txid ? { txid: row.txid } : {}),
      ...(row.txid && !row.txid.startsWith('direct:') ? { onChain: true } : {}),
      ...(typeof row.payload.re === 'string' ? { re: row.payload.re } : {}),
    }));
}
