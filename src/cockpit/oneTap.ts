// src/cockpit/oneTap.ts — a one-tap action (Release, Hold, Verified) that
// sends a real signed transaction each time (mw-t64a3.3). Each tap took a
// second or two and the view only drops the need at its next publish, so a
// second tap was easy and every one reached the Mayor. Whoever offers the same
// action for the same bead shares one state, held outside React so even two
// taps in the same tick send once: it is "sending" while the send runs, then
// "sent" until a view newer than the tap says otherwise, and back to idle at
// once if the send failed.
import { useSyncExternalStore } from 'react';
import { useAnswers, useViewIndex } from './hooks';
import { actionRemembered } from './remembered';
import { useSend, type SuccessToast } from './send';

const sending = new Set<string>();
const sentAt = new Map<string, number>();
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
function begin(key: string): boolean {
  if (sending.has(key)) return false;
  sending.add(key);
  changed();
  return true;
}

function finish(key: string, delivered: boolean): void {
  sending.delete(key);
  if (delivered) sentAt.set(key, Date.now());
  changed();
}

/** Forgets every tap this session; a test's clean slate. */
export function forgetTaps(): void {
  sending.clear();
  sentAt.clear();
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
  const waiting = sending.has(key) || sentSinceView || actionRemembered(answers, bead, action, viewWrittenAt);

  async function tap<T>(task: () => Promise<T>, success?: string | SuccessToast): Promise<T | undefined> {
    if (!bead || waiting || !begin(key)) return undefined;
    let result: T | undefined;
    try {
      result = await run(task, success);
    } finally {
      finish(key, result !== undefined);
    }
    return result;
  }
  return { waiting, tap };
}
