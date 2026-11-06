// src/services/sendTiming.ts — where the time goes from a tap on Send to the message in its thread (mw-8xe671n): each
// stage of a send leaves a performance mark, read in the browser's own timeline (DevTools' Performance panel, or
// performance.getEntriesByType('mark')), so a send that feels slow on his phone says which part was slow.
// tap: Send tapped. free: the composer is free again. queued: the message is in the outbox. shown: its bubble is in the
// thread, pending. shrunk: its pictures are cut down. sealed: a file is encrypted. uploaded: a file is up. answered: the backend answered the message's POST.

export type SendStage = 'tap' | 'free' | 'queued' | 'shown' | 'shrunk' | 'sealed' | 'uploaded' | 'answered';

/** The mark a stage leaves, by name. */
export function sendMark(stage: SendStage): string {
  return `postern:send:${stage}`;
}

/** Marks a stage of a send now; nothing where the browser keeps no timeline. */
export function markSend(stage: SendStage): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(sendMark(stage));
  } catch {
    // a timeline that is full or gone loses a mark, never the send
  }
}
