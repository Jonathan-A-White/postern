// src/model/threads.ts — every channel with the Mayor, as the Talk list
// shows it (plans/0021 decision 10): the factory-wide thread first, then each bead
// and named channel by its latest message, each titled from the live view where it can be.
// A thread is archived (mw-2y46l.6) when he put it away by hand, or its bead is
// closed and it has been quiet for 3 days; a newer message brings it back.
import type { ArchiveChoices, MessageRow } from '../data/db';
import { isClosed, type ViewIndex } from './tree';
import { parseThreadKey } from '../services/threads';
import { markdownToPlain } from '../markdown/plain';
import { mergeConversation, previewText } from './conversation';
import type { BeadComment } from './view';

export const GENERAL = 'general';

/** A bead's thread whose bead is closed (or gone from the view) goes under Archived
 * once its newest message is older than this (mw-2y46l.6). */
export const AUTO_ARCHIVE_AFTER_MS = 3 * 86_400_000;

export type { ArchiveChoices };

/** The newest entry the thread itself shows (its last message, or a bead comment
 * newer than it): what the Talk row reads its time and preview from. */
export interface ThreadLatest {
  /** Milliseconds since the epoch. */
  at: number;
  /** His own message, so the preview reads 'You: …'. */
  sent: boolean;
  preview: string;
}

export interface ThreadSummary {
  key: string;
  title: string;
  subtitle: string;
  /** The newest Postern message; archiving and his hand-made choices go by it. */
  last?: MessageRow;
  latest?: ThreadLatest;
  unread: number;
  archived: boolean;
}

export function titleFor(key: string, index?: ViewIndex): { title: string; subtitle: string } {
  if (key === GENERAL) return { title: 'Factory', subtitle: 'Everything not about one bead' };
  const ref = parseThreadKey(key);
  if (ref && 'bead' in ref) return { title: index?.byId.get(ref.bead)?.title ?? ref.bead, subtitle: ref.bead };
  if (ref && 'topic' in ref) return { title: ref.topic, subtitle: 'Channel' };
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

/** The newest entry the thread screen would show: the same merge it uses (mergeConversation),
 * so a bead's comment newer than its last message is the row's time and preview. */
function latestOf(rows: MessageRow[], comments: BeadComment[]): ThreadLatest | undefined {
  const item = mergeConversation(rows, comments).at(-1);
  if (!item) return undefined;
  if (item.source === 'comment') return { at: item.at, sent: item.speaker === 'you', preview: markdownToPlain(item.text) };
  const row = rows.find((candidate) => candidate.id === item.id);
  return row && { at: item.at, sent: row.direction === 'sent', preview: previewText(row) };
}

/** `comments` are the stored bead comments by thread key (e.g. 'bead:mw-x'): the Mayor's notes the thread shows beside the messages. */
export function summariseThreads(
  messages: MessageRow[],
  index?: ViewIndex,
  choices: ArchiveChoices = {},
  now: number = Date.now(),
  comments: ReadonlyMap<string, BeadComment[]> = new Map(),
): ThreadSummary[] {
  const byKey = new Map<string, ThreadSummary>();
  const rowsByKey = new Map<string, MessageRow[]>();
  byKey.set(GENERAL, { key: GENERAL, ...titleFor(GENERAL, index), unread: 0, archived: false });
  for (const row of messages) {
    const key = row.thread ?? GENERAL;
    const summary = byKey.get(key) ?? { key, ...titleFor(key, index), unread: 0, archived: false };
    if (!summary.last || row.ts >= summary.last.ts) summary.last = row;
    if (row.direction === 'received' && !row.read) summary.unread += 1;
    byKey.set(key, summary);
    const inThread = rowsByKey.get(key);
    if (inThread) inThread.push(row);
    else rowsByKey.set(key, [row]);
  }
  for (const summary of byKey.values()) {
    summary.archived = isArchived(summary, index, choices, now);
    const threadComments = comments.get(summary.key);
    if (threadComments?.length && summary.last) summary.latest = latestOf(rowsByKey.get(summary.key) ?? [], threadComments);
    if (!summary.latest && summary.last) summary.latest = { at: summary.last.ts * 1000, sent: summary.last.direction === 'sent', preview: previewText(summary.last) };
  }
  const general = byKey.get(GENERAL)!;
  const rest = [...byKey.values()].filter((summary) => summary.key !== GENERAL).sort((a, b) => (b.latest?.at ?? 0) - (a.latest?.at ?? 0));
  return [general, ...rest];
}
