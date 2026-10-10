// src/services/outbox.ts — the phone's outgoing queue (mw-jrx0s.10, Q5 A of mw-6ww.55): every
// tap, answer, message and talk turn is written to the Dexie outbox first and the caller goes
// on at once; this sender takes the rows in order, one at a time, through services/deliver.ts
// (direct, else on chain), and tries a failed one again after a growing wait. It resumes when
// the app opens (a reload loses nothing), when the browser says it is online, and when the live
// connection comes back. A sent row waits until its own record or event is seen coming back
// (since-paging, or the `card_answered` event naming its txid) and is then acked.
// A 4xx the backend gives (other than 408 and 429) is final: the row is marked failed with the
// backend's words (a provider's page made plain) and the rows behind it go on, until he taps Retry or Discard (mw-jrx0s.21).
// Talk turns are a lane of their own, so no upload or failing message holds one back.
import { answersRepo, eventsRepo, messagesRepo, newClientId, outboxRepo, viewRepo } from '../data/repositories';
import type { OutboxKind, OutboxRow } from '../data/db';
import type { GovernorAction } from '../model/conversation';
import { retryDelay } from '../model/outbox';
import { decodeView } from '../model/view';
import { isPermanentRefusal, RefusedError } from './apiAuth';
import { busyOf, plainMessage, waitingLine } from './chainBusy';
import type { TalkTurn } from '../model/talkLine';
import { attachmentMime, uploadAttachment } from './attachments';
import { deliverAction, deliverAnswer, deliverThreaded, writeBehind, type Delivered, type DeliverOptions } from './deliver';
import { deliverCallRequest } from './call';
import { getLiveState, deliverOptions, subscribeLive } from './live';
import { getKey, onKeyChange } from './keySession';
import { deliverTurn } from './talk';
import type { Attachment, ThreadRef } from './threads';

/** A file waiting to go with a message: stored whole, as base64 text (so no browser or test realm can lose its bytes), uploaded when its turn comes. */
export interface QueuedFile {
  name: string;
  type: string;
  data: string;
}

const CHUNK = 0x8000;

/** A file's bytes as base64 text, for the outbox row. */
export function packBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function unpackBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** What each kind carries in its row's payload. */
export interface QueuedMessage {
  text: string;
  thread?: ThreadRef;
  files: QueuedFile[];
  re?: string;
  /** The one-tap action this message stands for (`verified`): once it has gone it is remembered as that action's answer. */
  settles?: string;
  /** Files already uploaded by an earlier try, in order, so a retry does not upload them again. */
  uploaded?: Attachment[];
}

/** How long acked rows are kept before they are forgotten. */
const KEEP_ACKED_MS = 24 * 60 * 60 * 1000;
/** A record kept by the phone's own write when it sent has this seq until since-paging brings the real one. */
const OWN_WRITE_SEQ = Number.MAX_SAFE_INTEGER;

/** The sender runs two lanes at once, each in order: Talk turns on their own, so a turn is never
 * held behind a long file upload or a message waiting for its next try; everything else on the other. */
type LaneName = 'turn' | 'main';
interface Lane {
  name: LaneName;
  draining: Promise<void> | undefined;
  again: { force: boolean } | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}
const lanes: Lane[] = (['turn', 'main'] as const).map((name) => ({ name, draining: undefined, again: undefined, timer: undefined }));
let generation = 0;

/** The seq of the view the phone holds now (the one on screen), when it has one. */
async function shownViewSeq(): Promise<number | undefined> {
  try {
    const stored = await viewRepo.get();
    return stored ? decodeView(stored.plaintext).seq : undefined;
  } catch {
    return undefined;
  }
}

/** The seq a row's payload carries (see enqueue). */
function viewSeqOf(row: OutboxRow): number | undefined {
  return typeof row.payload.viewSeq === 'number' ? row.payload.viewSeq : undefined;
}

/** Writes one thing he did to the outbox and wakes the sender; resolves once it is written, not once it is sent. */
export async function enqueue(row: { kind: OutboxKind; bead?: string; payload: Record<string, unknown>; thread?: string; label?: string }): Promise<number> {
  // What he taps is judged against the view he was shown: its seq travels with the row (docs/protocol.md §13).
  const viewSeq = row.kind === 'action' || row.kind === 'answer' || (row.kind === 'message' && typeof row.payload.settles === 'string') ? await shownViewSeq() : undefined;
  const id = await outboxRepo.add({ kind: row.kind, bead: row.bead ?? '', payload: viewSeq !== undefined ? { ...row.payload, viewSeq } : row.payload, ...(row.thread !== undefined ? { thread: row.thread } : {}), ...(row.label !== undefined ? { label: row.label } : {}) });
  kickOutbox();
  return id;
}

async function deliverRow(row: OutboxRow, options: DeliverOptions): Promise<Delivered> {
  switch (row.kind) {
    case 'answer':
      return deliverAnswer(row.bead, String(row.payload.answer ?? ''), options);
    case 'action':
      return deliverAction(row.payload.action as GovernorAction, options);
    case 'turn':
      return deliverTurn(row.payload.turn as TalkTurn, options);
    case 'call':
      return deliverCallRequest(String(row.payload.text ?? ''), Number(row.payload.at ?? 0), options);
    case 'message':
      return deliverMessage(row, options);
  }
}

/** Uploads the message's files that are not up yet (docs/protocol.md §8), then delivers it as ONE message. */
async function deliverMessage(row: OutboxRow, options: DeliverOptions): Promise<Delivered> {
  const message = row.payload as unknown as QueuedMessage;
  const uploaded = [...(message.uploaded ?? [])];
  for (const file of message.files.slice(uploaded.length)) {
    uploaded.push(await uploadAttachment({ bytes: unpackBytes(file.data), mime: attachmentMime(file.type), name: file.name, senderKey: options.key, recipientPublicKeyHex: options.mayorKey }));
    await outboxRepo.update(row.id as number, { payload: { ...row.payload, uploaded } });
  }
  return deliverThreaded({ thread: message.thread, text: message.text, attachments: uploaded, re: message.re }, options);
}

/** What the phone remembers of a delivered answer, action or message that settles one: the card it settles leaves the queue at once. */
function rememberDelivered(row: OutboxRow, delivered: Delivered): void {
  const viewSeq = viewSeqOf(row);
  const seq = viewSeq !== undefined ? { viewSeq } : {};
  if (row.kind === 'answer') writeBehind(answersRepo.save({ bead: row.bead, answer: String(row.payload.answer ?? ''), txid: delivered.txid, ...seq }), 'your answer');
  else if (row.kind === 'action') {
    const action = row.payload.action as GovernorAction;
    writeBehind(answersRepo.save({ bead: action.bead, answer: action.action, txid: delivered.txid, ...seq }), 'your action');
  } else if (row.kind === 'message' && typeof row.payload.settles === 'string') {
    writeBehind(answersRepo.save({ bead: row.bead, answer: row.payload.settles, txid: delivered.txid, ...seq }), 'your action');
  }
}

/** Acks every sent row whose own record is kept (by since-paging) or whose event has been heard; forgets old acked rows. */
export async function ackSent(): Promise<void> {
  for (const row of await outboxRepo.sent()) {
    if (!row.txid) continue;
    const record = await messagesRepo.getByTxid(row.txid);
    const paged = record !== undefined && record.seq !== OWN_WRITE_SEQ;
    if (paged || (await eventsRepo.hasDetail(row.txid))) await outboxRepo.update(row.id as number, { state: 'acked' });
  }
  await outboxRepo.pruneAcked(Date.now() - KEEP_ACKED_MS);
}

function wakeAt(lane: Lane, at: number): void {
  clearTimeout(lane.timer);
  lane.timer = setTimeout(() => kickLane(lane, false), Math.max(0, at - Date.now()));
}

async function drain(lane: Lane, force: boolean): Promise<void> {
  const mine = generation;
  await ackSent();
  for (;;) {
    const row = await outboxRepo.head(lane.name);
    if (!row || mine !== generation) return;
    if (!force && row.nextAt !== undefined && row.nextAt > Date.now()) return wakeAt(lane, row.nextAt);
    force = false;
    const base = deliverOptions(getKey());
    if (!base) {
      // Locked, or the Mayor not yet known: the next live state or key change wakes the sender; this is the fallback.
      // The row has now waited, so the status line says so.
      if (row.attempts === 0) await outboxRepo.update(row.id as number, { attempts: 1 });
      wakeAt(lane, Date.now() + retryDelay(row.attempts + 1));
      return;
    }
    // The row's id goes with every try; a row an older build wrote is given one now.
    const clientId = row.clientId ?? newClientId();
    if (row.clientId === undefined) await outboxRepo.update(row.id as number, { clientId });
    const options = { ...base, clientId };
    let delivered: Delivered;
    try {
      delivered = await deliverRow(row, options);
    } catch (err) {
      if (mine !== generation) return;
      if (isPermanentRefusal(err)) {
        // Refused for good (a 4xx): it is marked failed with the backend's words, waits for Retry or Discard, and the rows behind it go on.
        await outboxRepo.update(row.id as number, { state: 'failed', failure: plainMessage(err), attempts: row.attempts + 1, nextAt: undefined });
        continue;
      }
      // Out of reach or a passing trouble: the row keeps its place, and nothing behind it in its lane goes ahead of it.
      const attempts = row.attempts + 1;
      const nextAt = Date.now() + retryDelay(attempts);
      // When the backend answered with trouble (a busy WhatsOnChain, a provider refusal) the row says so in one plain line; a lost connection says nothing more than pending.
      const note = err instanceof RefusedError || busyOf(err) ? waitingLine(err) : undefined;
      await outboxRepo.update(row.id as number, { attempts, nextAt, note });
      return wakeAt(lane, nextAt);
    }
    if (mine !== generation) return;
    await outboxRepo.update(row.id as number, { state: 'sent', txid: delivered.txid, attempts: row.attempts + 1, nextAt: undefined, note: undefined });
    rememberDelivered(row, delivered);
  }
}

/** Wakes one lane: one pass at a time. */
function kickLane(lane: Lane, force: boolean): void {
  if (lane.draining) {
    lane.again = { force: force || (lane.again?.force ?? false) };
    return;
  }
  const run = drain(lane, force)
    .catch((err: unknown) => console.warn('The outbox could not be read:', err))
    .finally(() => {
      if (lane.draining === run) lane.draining = undefined;
      const next = lane.again;
      lane.again = undefined;
      if (next) kickLane(lane, next.force);
    });
  lane.draining = run;
}

/** Wakes the sender: one pass at a time in each lane. `force` skips the wait a failed row set itself (the network is back). */
export function kickOutbox(force = false): void {
  for (const lane of lanes) kickLane(lane, force);
}

/** Retry on a refused row: back in the queue in its old place, and tried at once. */
export async function retryRow(id: number): Promise<void> {
  await outboxRepo.requeue(id);
  kickOutbox(true);
}

/** Discard on a refused row: forgotten, so the card or bubble it was on is as it was before. */
export async function discardRow(id: number): Promise<void> {
  await outboxRepo.remove(id);
}

/** Resolves once the sender has gone quiet (a test's seam; the app never waits on it). */
export async function settledOutbox(): Promise<void> {
  while (lanes.some((lane) => lane.draining)) await Promise.all(lanes.map((lane) => lane.draining));
}

/** Starts the sender for this page: resumes the queue now, and again whenever the phone may be back in reach. Resolves to its stop. */
export function startOutbox(): () => void {
  let live = getLiveState();
  const stopLive = subscribeLive(() => {
    const next = getLiveState();
    const back = (next.status === 'live' || next.status === 'polling') && (live.status !== next.status || live.reconnects !== next.reconnects || live.syncs !== next.syncs);
    live = next;
    // Every sync also looks for the records that ack what was sent.
    kickOutbox(back);
  });
  const stopKey = onKeyChange(() => kickOutbox(true));
  const online = () => kickOutbox(true);
  const visible = () => {
    if (typeof document === 'undefined' || !document.hidden) kickOutbox(true);
  };
  if (typeof window !== 'undefined') window.addEventListener('online', online);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  kickOutbox();
  return () => {
    stopLive();
    stopKey();
    if (typeof window !== 'undefined') window.removeEventListener('online', online);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
  };
}

/** Forgets what this page holds in memory, as a reload does: the rows in Dexie stay. A test's seam. */
export function forgetOutboxState(): void {
  generation++;
  for (const lane of lanes) {
    clearTimeout(lane.timer);
    lane.timer = undefined;
    lane.draining = undefined;
    lane.again = undefined;
  }
}
