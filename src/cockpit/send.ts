// src/cockpit/send.ts — what the screens call to say something or tap an action
// (plans/0021 decisions 7, 10–12): answers, actions, comments and files, each
// encrypted to the pinned Mayor and delivered directly. Files go up first
// (docs/protocol.md §8), then go as one message, the caption its text.
import { useState } from 'react';
import { deliverAction, deliverAnswer, deliverMoveHome, deliverThreaded, writeBehind, type Delivered } from '../services/deliver';
import { ApiTimeoutError } from '../services/apiAuth';
import { deliverOptions } from '../services/live';
import { getKey } from '../services/keySession';
import { attachmentMime, MAX_ATTACHMENT_BYTES, uploadAttachment } from '../services/attachments';
import { answersRepo } from '../data/repositories';
import type { GovernorAction } from '../model/conversation';
import type { HandsStep } from '../model/hands';
import { buildApproval, stepUp } from '../services/hands';
import type { HomeHost } from '../services/standby';
import { deliverTurn } from '../services/talk';
import type { TalkTurn } from '../model/talkLine';
import type { Attachment, ThreadRef } from '../services/threads';
import { toast } from '../ui/toastStore';
import { navigate } from '../router';
import type { Route } from '../nav/route';

export class NotReady extends Error {}

function options() {
  const opts = deliverOptions(getKey());
  if (!opts) throw new NotReady(getKey() ? "The Mayor's key is not known yet — the backend has not answered." : 'Unlock first.');
  return opts;
}

export async function sendAnswer(bead: string, answer: string): Promise<Delivered> {
  const delivered = await deliverAnswer(bead, answer, options());
  writeBehind(answersRepo.save({ bead, answer, txid: delivered.txid }), 'your answer');
  return delivered;
}

/** A one-tap action (docs/protocol.md §13). It is remembered like an answer, so
 * the need it settles leaves the queue at once rather than at the next view. */
export async function sendAction(action: GovernorAction): Promise<Delivered> {
  const delivered = await deliverAction(action, options());
  writeBehind(answersRepo.save({ bead: action.bead, answer: action.action, txid: delivered.txid }), 'your action');
  return delivered;
}

/** Sends one turn of the Talk line (docs/protocol.md §20): class `talk`, straight to the backend. */
export function sendTurn(turn: TalkTurn): Promise<Delivered> {
  return deliverTurn(turn, options());
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

/** Sends text and files to a thread as ONE message (docs/protocol.md §8): one
 * file as `attachment`, two or more as `attachments` in the order given, the
 * text as its caption. Every file is uploaded first, so a failed upload sends
 * nothing. */
export async function sendToThread(thread: ThreadRef | undefined, text: string, files: OutgoingFile[] = [], re?: string): Promise<Delivered[]> {
  const opts = options();
  const attachments: Attachment[] = [];
  for (const file of files) {
    const mime = attachmentMime(file.type);
    if (!mime) throw new Error(`${file.name}: not a type Postern carries.`);
    attachments.push(await uploadAttachment({ bytes: file.bytes, mime, senderKey: opts.key, recipientPublicKeyHex: opts.mayorKey }));
  }
  return [await deliverThreaded({ thread, text, attachments, re }, opts)];
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
