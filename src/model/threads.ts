// src/model/threads.ts — every conversation with the Mayor, as the Talk list
// shows it (plans/0021 decision 10): the factory-wide thread first, then each bead
// and topic by its latest message, each titled from the live view where it can be.
// A thread is archived (mw-2y46l.6) when he put it away by hand, or its bead is
// closed and it has been quiet for 3 days; a newer message brings it back.
import type { ArchiveChoices, MessageRow } from '../data/db';
import { isClosed, type ViewIndex } from './tree';
import { parseThreadKey } from '../services/threads';

export const GENERAL = 'general';

/** A bead's thread whose bead is closed (or gone from the view) goes under Archived
 * once its newest message is older than this (mw-2y46l.6). */
export const AUTO_ARCHIVE_AFTER_MS = 3 * 86_400_000;

export type { ArchiveChoices };

export interface ThreadSummary {
  key: string;
  title: string;
  subtitle: string;
  last?: MessageRow;
  unread: number;
  archived: boolean;
}

export function titleFor(key: string, index?: ViewIndex): { title: string; subtitle: string } {
  if (key === GENERAL) return { title: 'Factory', subtitle: 'Everything not about one bead' };
  const ref = parseThreadKey(key);
  if (ref && 'bead' in ref) return { title: index?.byId.get(ref.bead)?.title ?? ref.bead, subtitle: ref.bead };
  if (ref && 'topic' in ref) return { title: ref.topic, subtitle: 'Topic' };
  return { title: key, subtitle: '' };
}

function isArchived(summary: ThreadSummary, index: ViewIndex | undefined, choices: ArchiveChoices, now: number): boolean {
  const last = summary.last;
  if (summary.key === GENERAL || !last) return false;
  const lastMs = last.ts * 1000;
  const choice = choices[summary.key];
  if (choice && lastMs <= choice.at) return choice.archived;
  const ref = parseThreadKey(summary.key);
  if (!index || !ref || !('bead' in ref)) return false;
  const bead = index.byId.get(ref.bead);
  return (!bead || isClosed(bead)) && now - lastMs > AUTO_ARCHIVE_AFTER_MS;
}

export function summariseThreads(messages: MessageRow[], index?: ViewIndex, choices: ArchiveChoices = {}, now: number = Date.now()): ThreadSummary[] {
  const byKey = new Map<string, ThreadSummary>();
  byKey.set(GENERAL, { key: GENERAL, ...titleFor(GENERAL, index), unread: 0, archived: false });
  for (const row of messages) {
    const key = row.thread ?? GENERAL;
    const summary = byKey.get(key) ?? { key, ...titleFor(key, index), unread: 0, archived: false };
    if (!summary.last || row.ts >= summary.last.ts) summary.last = row;
    if (row.direction === 'received' && !row.read) summary.unread += 1;
    byKey.set(key, summary);
  }
  for (const summary of byKey.values()) summary.archived = isArchived(summary, index, choices, now);
  const general = byKey.get(GENERAL)!;
  const rest = [...byKey.values()].filter((summary) => summary.key !== GENERAL).sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
  return [general, ...rest];
}
