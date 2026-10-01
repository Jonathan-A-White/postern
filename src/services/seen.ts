// src/services/seen.ts — the app's half of "no notification for what he is
// looking at" (mw-gq6.166). The service worker (src/sw.ts) asks a focused window
// whether a pushed message is already on its screen: answerSeen() says so from the
// route in the address bar. And when a screen shows messages (marks a thread
// read), announceSeen() tells the worker so it can close their notifications.
import { messagesRepo } from '../data/repositories/messages-repo';
import { parseRoute, type Route } from '../nav/route';
import { threadUrlOfTxid } from '../push/tapTarget';
import { refreshNow } from './live';

const GENERAL = 'general';

/** Whether the screen `current` shows the thread `target` names: the same channel
 * (or a bead's own thread on its bead screen), and, when a reply thread is open,
 * the same post. With a channel open, a reply inside it counts: its post's
 * 'N replies' row is on screen. */
export function routeShows(current: Route, target: Route): boolean {
  if (target.view !== 'talk') return false;
  const channel = target.thread ?? GENERAL;
  if (current.view === 'bead') return channel === `bead:${current.id}`;
  if (current.view !== 'talk' || current.thread === undefined) return false;
  if (current.thread !== channel) return false;
  return current.root === undefined || current.root.toLowerCase() === target.root?.toLowerCase();
}

/** Whether the message with this txid is in the channel or thread the app shows
 * right now. Brings the inbox in first if the phone does not hold it yet; a
 * message it cannot decrypt is not on screen. */
export async function answerSeen(txid: string): Promise<boolean> {
  if (!(await messagesRepo.getByTxid(txid))) await refreshNow();
  const url = await threadUrlOfTxid(txid);
  if (!url) return false;
  return routeShows(parseRoute(window.location.search), parseRoute(new URL(url, window.location.origin).search));
}

/** Tells the worker these messages are on screen, so it closes their notifications. */
export function announceSeen(txids: string[]): void {
  if (txids.length === 0 || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // A page in the background has not shown anything to him yet.
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  void navigator.serviceWorker.ready.then((registration) => {
    for (const txid of txids) registration.active?.postMessage({ type: 'seen', txid });
  });
}

/** What a screen does while it shows a thread: marks its received messages read and announces them. */
export function markThreadSeen(key: string | undefined): Promise<void> {
  return messagesRepo.markThreadRead(key).then(announceSeen);
}
