// src/cockpit/oneTap.ts — a one-tap action (Release, Hold, Verified) that
// sends a real signed transaction each time (mw-t64a3.3). Each tap took a
// second or two and the view only drops the need at its next publish, so a
// second tap was easy and every one reached the Mayor. Whoever offers the same
// action for the same bead shares one state, held outside React so even two
// taps in the same tick send once: it is "sending" while the send runs, then
// "sent" until the view has passed the event that echoed the tap (docs/protocol.md §13;
// no clock is compared when the view carries a seq), and back to idle at once if the send failed.
import { useSyncExternalStore } from 'react';
import { eventsRepo } from '../data/repositories';
import { useAnswers, useLiveQuery, useOutbox, useViewIndex } from './hooks';
import { pendingAction } from '../model/outbox';
import { actionRemembered, rememberedTxid } from './remembered';
import { useSend, type SuccessToast } from './send';

const sending = new Set<string>();
const sentAt = new Map<string, number>();
// What each tap said and when, for a card that tells him what he answered (a question's option).
const tapped = new Map<string, { label: string; at: number }>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const keyOf = (bead: string, action: string) => `${action}:${bead}`;

/** Claims the tap; false when the same action on the same bead is already on its way. */
function begin(key: string, label: string): boolean {
  if (sending.has(key)) return false;
  sending.add(key);
  tapped.set(key, { label, at: Date.now() });
  changed();
  return true;
}

function finish(key: string, delivered: boolean): void {
  sending.delete(key);
  if (delivered) sentAt.set(key, Date.now());
  else tapped.delete(key);
  changed();
}

/** Forgets every tap this session; a test's clean slate. */
export function forgetTaps(): void {
  sending.clear();
  sentAt.clear();
  tapped.clear();
  changed();
}

/** Whether this action on this bead is on its way or sent and not yet in a newer view. */
export function useOneTap(bead: string, action: string) {
  const { run } = useSend();
  const answers = useAnswers();
  const view = useViewIndex()?.index.view;
  const stamp = { writtenAt: view?.written_at, seq: view?.seq };
  useSyncExternalStore(subscribe, () => version);
  const key = keyOf(bead, action);
  const sentTs = sentAt.get(key);
  const txid = rememberedTxid(answers, bead, action);
  const echoSeq = useLiveQuery(() => (txid ? eventsRepo.seqOfDetail(txid) : Promise.resolve(undefined)), [txid], undefined as number | undefined);
  const row = answers.find((candidate) => candidate.bead === bead && candidate.answer === action);
  // Sent in this session but not yet remembered: with a seq on the view the remembered row decides
  // as soon as it is written (from this tap on); without one, the view's written_at does.
  const sentSinceView =
    sentTs !== undefined &&
    (stamp.seq !== undefined ? !(row && row.ts >= Math.floor((tapped.get(key)?.at ?? sentTs) / 1000)) : Number.isNaN(Date.parse(stamp.writtenAt ?? '')) || sentTs > Date.parse(stamp.writtenAt ?? ''));
  // An action still in the outbox (mw-jrx0s.10) keeps the button dead, across a reload too.
  const queued = pendingAction(useOutbox(), bead, action);
  const waiting = sending.has(key) || sentSinceView || actionRemembered(answers, bead, action, stamp, echoSeq) || queued !== undefined;

  /** `label` is what the tap said (the option he chose); `said` hands it back while the tap is waiting. */
  async function tap<T>(task: () => Promise<T>, success?: string | SuccessToast, label = ''): Promise<T | undefined> {
    if (!bead || waiting || !begin(key, label)) return undefined;
    let result: T | undefined;
    try {
      result = await run(task, success);
    } finally {
      finish(key, result !== undefined);
    }
    return result;
  }
  return { waiting, tap, said: waiting ? tapped.get(key) : undefined, pending: queued !== undefined, queued };
}
