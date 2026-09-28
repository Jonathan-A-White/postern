// src/cockpit/shareInbox.ts — carries files shared in from another app (plans/0021
// decision 12) from the Share screen, where he picks the thread, to that
// thread's composer, which takes them once.
import type { ShareRow } from '../data/db';

let pending: Pick<ShareRow, 'text' | 'files'> | null = null;

export function setPendingShare(share: Pick<ShareRow, 'text' | 'files'>): void {
  pending = share;
}

export function takePendingShare(): Pick<ShareRow, 'text' | 'files'> | null {
  const taken = pending;
  pending = null;
  return taken;
}
