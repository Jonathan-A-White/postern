// src/services/answerWaiting.ts — a Mayor answer on the Talk line that arrived while he was looking at
// some other screen (mw-am3yjh.3): the app keeps it, and a bar on every screen (src/cockpit/AnswerBar.tsx)
// says it waits; a tap opens the Talk line, which plays what he has not heard. While the page is hidden
// nothing is kept here: the notification (src/services/talkAnswerNotice.ts, src/sw.ts) tells him then.
import { useSyncExternalStore } from 'react';
import type { MessageRow } from '../data/db';
import { parseRoute } from '../nav/route';
import { decodeTurn } from './talk';

/** An answer that came this long ago is history being caught up, not an answer to wait for. */
export const ANSWER_FRESH_SECONDS = 3600;

export interface AnswerWaiting {
  /** The row of the answer. */
  id: string;
}

let waiting: AnswerWaiting | undefined;
const listeners = new Set<() => void>();

function set(next: AnswerWaiting | undefined): void {
  waiting = next;
  for (const listener of listeners) listener();
}

export function getAnswerWaiting(): AnswerWaiting | undefined {
  return waiting;
}

export function dismissAnswerWaiting(): void {
  if (waiting) set(undefined);
}

export function useAnswerWaiting(): AnswerWaiting | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAnswerWaiting,
    getAnswerWaiting,
  );
}

/** A row just kept for the first time: remembered when it is the Mayor's fresh, unheard answer and he is on a screen other than the Talk line. */
export function noteArrivedAnswer(row: MessageRow, nowSeconds: number): void {
  if (row.class !== 'talk' || row.direction !== 'received' || row.heard !== false) return;
  if (nowSeconds - row.ts > ANSWER_FRESH_SECONDS) return;
  if (decodeTurn(row.plaintext)?.role !== 'answer') return;
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (parseRoute(window.location.search).view === 'line') return;
  set({ id: row.id });
}
