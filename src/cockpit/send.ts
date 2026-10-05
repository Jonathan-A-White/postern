// src/cockpit/send.ts — what the screens call to say something or tap an action
// (plans/0021 decisions 7, 10–12): answers, actions, comments and files, each
// encrypted to the pinned Mayor and delivered directly. Files go up first
// (docs/protocol.md §8), then go as one message, the caption its text.
// An answer, an action, a message, a Talk turn and a Call me are written to the
// phone's outbox first and these return at once (mw-jrx0s.10): src/services/outbox.ts
// sends them in order, with retries, and the screens show each pending until it has gone.
import { useState } from 'react';
import { deliverAction, deliverMoveHome, type Delivered } from '../services/deliver';
import { ApiTimeoutError } from '../services/apiAuth';
import { deliverOptions } from '../services/live';
import { getKey } from '../services/keySession';
import { attachmentMime, MAX_ATTACHMENT_BYTES } from '../services/attachments';
import { enqueue, packBytes, type QueuedMessage } from '../services/outbox';
import type { GovernorAction } from '../model/conversation';
import { verifiedWords, type VerifiedWhere } from '../model/verified';
import type { HandsStep } from '../model/hands';
import { buildApproval, stepUp } from '../services/hands';
import type { HomeHost } from '../services/standby';
import { deliverCallLater } from '../services/call';
import type { TalkTurn } from '../model/talkLine';
import { threadKey, type ThreadRef } from '../services/threads';
import { toast } from '../ui/toastStore';
import { navigate } from '../router';
import type { Route } from '../nav/route';

export class NotReady extends Error {}

function options() {
  const opts = deliverOptions(getKey());
  if (!opts) throw new NotReady(getKey() ? "The Mayor's key is not known yet — the backend has not answered." : 'Unlock first.');
  return opts;
}

/** What a send that was written to the outbox hands back: its row's id. It has not gone yet. */
export interface Queued {
  id: number;
}

/** His answer to a question on `bead` (docs/protocol.md §6), queued: `answer` is what the card says he tapped. */
export async function sendAnswer(bead: string, answer: string): Promise<Queued> {
  return { id: await enqueue({ kind: 'answer', bead, payload: { answer }, label: answer }) };
}

/** A one-tap action (docs/protocol.md §13), queued. Once it has gone it is remembered like an
 * answer, so the need it settles leaves the queue at once rather than at the next view. */
export async function sendAction(action: GovernorAction): Promise<Queued> {
  return { id: await enqueue({ kind: 'action', bead: action.bead, payload: { action }, label: action.action }) };
}

/** Queues one turn of the Talk line (docs/protocol.md §20): class `talk`, straight to the backend once it answers. */
export async function sendTurn(turn: TalkTurn): Promise<Queued> {
  return { id: await enqueue({ kind: 'turn', payload: { turn }, label: turn.text }) };
}

/** Queues a Call me request (docs/protocol.md §21): class `call`. `at` is Unix seconds. */
export async function sendCallRequest(text: string, at: number): Promise<Queued> {
  return { id: await enqueue({ kind: 'call', payload: { text, at }, label: text }) };
}

/** Tells the Mayor he is putting a ring off (docs/protocol.md §21): class `call`, naming the ring. */
export function sendCallLater(ringTxid: string): Promise<Delivered> {
  return deliverCallLater(ringTxid, options());
}

/** Asks the Mayor's host to make `host` the factory's home (docs/protocol.md §18).
 * It goes through whichever backend answers, home or standby. */
export function sendMoveHome(host: HomeHost): Promise<Delivered> {
  return deliverMoveHome(host, options());
}

/** docs/protocol.md §17: a fresh fingerprint, then his signed approval of one
 * hands step, delivered like any action. Not remembered as an answer: the need
 * stays in the queue until every step has run. */
export async function approveHandsStep(bead: string, step: HandsStep): Promise<Delivered> {
  const opts = options();
  await stepUp();
  return deliverAction(await buildApproval(bead, step, opts.key), opts);
}

export interface OutgoingFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export function refuseFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!attachmentMime(file.type)) return `${file.name}: Postern carries images, voice, PDF and plain text only.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is over 8 MB.`;
  return undefined;
}

/** Queues text and files for a thread as ONE message (docs/protocol.md §8): one
 * file as `attachment`, two or more as `attachments` in the order given, the
 * text as its caption. The files are kept whole in the outbox and uploaded first
 * when the message's turn comes, so nothing is sent until every file is up. */
export async function sendToThread(thread: ThreadRef | undefined, text: string, files: OutgoingFile[] = [], re?: string, settles?: string): Promise<Queued[]> {
  for (const file of files) if (!attachmentMime(file.type)) throw new Error(`${file.name}: not a type Postern carries.`);
  const payload: QueuedMessage = { text, files: files.map(({ name, type, bytes }) => ({ name, type, data: packBytes(bytes) })), ...(thread !== undefined ? { thread } : {}), ...(re !== undefined ? { re } : {}), ...(settles !== undefined ? { settles } : {}) };
  return [{ id: await enqueue({ kind: 'message', bead: thread && 'bead' in thread ? thread.bead : '', payload: payload as unknown as Record<string, unknown>, thread: threadKey(thread) }) }];
}

/** His Verified tap (docs/protocol.md §13): a channel message to the bead that begins VERIFIED and says where he tapped.
 * It settles `verified` as an action did: once it has gone the card is remembered as answered. */
export function sendVerified(bead: string, where: VerifiedWhere): Promise<Queued[]> {
  return sendToThread({ bead }, verifiedWords(bead, where), [], undefined, 'verified');
}

export const MAY_HAVE_GONE = 'May have gone: check the channel before sending again';
export const NOT_SENT = 'Not sent: try again';

/** The words a failed send shows: a timeout says whether the message could have gone. */
export function describeSendError(err: unknown): string {
  if (err instanceof ApiTimeoutError) return err.sent ? MAY_HAVE_GONE : NOT_SENT;
  return err instanceof Error ? err.message : String(err);
}

/** A success toast that also offers to open somewhere (a Needs card's message: its thread). */
export interface SuccessToast {
  text: string;
  open: Route;
}

/** Runs a send, reporting success or failure as a toast; `busy` while it runs. */
export function useSend() {
  const [busy, setBusy] = useState(false);
  async function run<T>(task: () => Promise<T>, success?: string | SuccessToast): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await task();
      if (typeof success === 'string') toast(success);
      else if (success) toast(success.text, 'ok', 6000, { label: 'Open', onClick: () => navigate(success.open) });
      return result;
    } catch (err) {
      toast(describeSendError(err), 'error', err instanceof ApiTimeoutError ? 10_000 : 6000);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
