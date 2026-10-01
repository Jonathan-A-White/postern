// src/model/outbox.ts — what the screens read off the outgoing queue (mw-jrx0s.10): which
// card, bubble or turn still waits to go, the one-line note for the status line, and how
// long a failed send waits before its next try. Pure: the rows are src/data/db.ts's OutboxRow.
import type { MessageRow, OutboxRow } from '../data/db';
import type { ConversationItem } from './conversation';

/** The one line the status line shows while anything he did has not yet gone. */
export const SENDING_WHEN_BACK = 'Sending when back online';

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** How long a row waits for its next try after `attempts` failures (2 s, 4 s, 8 s … at most a minute). */
export function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Whether the row has not yet been taken by a backend or the chain. */
export function isPending(row: OutboxRow): boolean {
  return row.state === 'pending';
}

/** His answer to a question on `bead` asked at `sinceMs` that has not yet gone. */
export function pendingAnswer(rows: OutboxRow[], bead: string, sinceMs: number): OutboxRow | undefined {
  return rows.find((row) => row.kind === 'answer' && row.bead === bead && isPending(row) && row.created >= sinceMs);
}

/** His one-tap `action` on `bead` that has not yet gone. */
export function pendingAction(rows: OutboxRow[], bead: string, action: string): OutboxRow | undefined {
  return rows.find((row) => row.kind === 'action' && row.bead === bead && isPending(row) && (row.payload.action as { action?: string } | undefined)?.action === action);
}

/** His Talk turn `talkId`/`turn` that has not yet gone. */
export function pendingTurn(rows: OutboxRow[], talkId: string, turn: number): OutboxRow | undefined {
  return rows.find((row) => {
    const sent = row.payload.turn as { talk?: { id?: string; turn?: number } } | undefined;
    return row.kind === 'turn' && isPending(row) && sent?.talk?.id === talkId && sent.talk.turn === turn;
  });
}

/** Whether anything he did is waiting for the backend or the chain to come back: a row whose first try has failed. */
export function anyPending(rows: OutboxRow[]): boolean {
  return rows.some((row) => isPending(row) && row.attempts > 0);
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
      ...(row.txid ? { txid: row.txid } : {}),
      ...(typeof row.payload.re === 'string' ? { re: row.payload.re } : {}),
    }));
}
