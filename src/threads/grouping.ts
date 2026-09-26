// src/threads/grouping.ts — mw-f758y.21.3: groups synced messages into the
// threads the Threads screen lists, one row per distinct `thread` (docs/protocol.md
// §1/§6, src/services/threads.ts). Pure functions, kept apart from the screen
// components the same way src/projects/grouping.ts keeps ordering testable
// without rendering anything.
import type { MessageRow } from '../data/db';
import type { Snapshot } from '../services/questions';
import { parseThreadKey, type ThreadRef } from '../services/threads';

export interface ThreadSummary {
  key: string | undefined;
  ref: ThreadRef | undefined;
  title: string;
  lastActivity: number;
  unreadCount: number;
}

/** A bead thread's title: the epic's own title when the bead id names an epic
 * directly, otherwise the matching id's title from the snapshot's needs_you,
 * landed or working lists (wherever the bead currently sits), or the bead id
 * itself when the snapshot doesn't know it. */
function titleForBead(beadId: string, snapshot: Snapshot | undefined): string {
  for (const epic of snapshot?.epics ?? []) {
    if (epic.id === beadId) return epic.title;
    const item = epic.needs_you.find((candidate) => candidate.id === beadId) ??
      epic.landed.find((candidate) => candidate.id === beadId) ??
      epic.working.find((candidate) => candidate.id === beadId);
    if (item) return item.title;
  }
  return beadId;
}

/** A thread's title: a bead thread's from the snapshot (or its id), a topic
 * thread's own name, or "General" for the general thread (`ref` undefined). */
export function titleForThread(ref: ThreadRef | undefined, snapshot: Snapshot | undefined): string {
  if (!ref) return 'General';
  return 'bead' in ref ? titleForBead(ref.bead, snapshot) : ref.topic;
}

/** One summary per distinct thread among `messages`, newest activity first —
 * except the general thread (no key), which always sorts last regardless of its
 * own activity, per mw-f758y.21.3. */
export function summarizeThreads(messages: MessageRow[], snapshot: Snapshot | undefined): ThreadSummary[] {
  const groups = new Map<string | undefined, MessageRow[]>();
  for (const message of messages) {
    const group = groups.get(message.thread);
    if (group) group.push(message);
    else groups.set(message.thread, [message]);
  }

  const summaries = Array.from(groups.entries()).map(([key, rows]): ThreadSummary => {
    const ref = parseThreadKey(key);
    return {
      key,
      ref,
      title: titleForThread(ref, snapshot),
      lastActivity: Math.max(...rows.map((row) => row.ts)),
      unreadCount: rows.filter((row) => row.direction === 'received' && !row.read).length,
    };
  });

  const named = summaries.filter((summary) => summary.key !== undefined).sort((a, b) => b.lastActivity - a.lastActivity);
  const general = summaries.filter((summary) => summary.key === undefined);
  return [...named, ...general];
}
