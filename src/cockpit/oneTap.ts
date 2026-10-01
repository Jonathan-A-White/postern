// src/cockpit/oneTap.ts — a one-tap action (Release, Hold, Verified) that
// sends a real signed transaction each time (mw-t64a3.3). Each tap took a
// second or two and the view only drops the need at its next publish, so a
// second tap was easy and every one reached the Mayor. Whoever offers the same
// action for the same bead shares one state, held outside React so even two
// taps in the same tick send once: it is "sending" while the send runs, then
// "sent" until a view newer than the tap says otherwise, and back to idle at
// once if the send failed.
import { useSyncExternalStore } from 'react';
import { useAnswers, useOutbox, useViewIndex } from './hooks';
import { pendingAction } from '../model/outbox';
import { actionRemembered } from './remembered';
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
  const viewWrittenAt = useViewIndex()?.index.view.written_at;
  useSyncExternalStore(subscribe, () => version);
  const key = keyOf(bead, action);
  const sentTs = sentAt.get(key);
  const published = Date.parse(viewWrittenAt ?? '');
  const sentSinceView = sentTs !== undefined && (Number.isNaN(published) || sentTs > published);
  // An action still in the outbox (mw-jrx0s.10) keeps the button dead, across a reload too.
  const queued = pendingAction(useOutbox(), bead, action);
  const waiting = sending.has(key) || sentSinceView || actionRemembered(answers, bead, action, viewWrittenAt) || queued !== undefined;

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
