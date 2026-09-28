// src/model/threads.ts — every conversation with the Mayor, as the Talk list
// shows it (plans/0021 decision 10): the factory-wide thread first, then each bead
// and topic by its latest message, each titled from the live view where it can be.
import type { MessageRow } from '../data/db';
import type { ViewIndex } from './tree';
import { parseThreadKey } from '../services/threads';

export const GENERAL = 'general';

interface ThreadSummary {
  key: string;
  title: string;
  subtitle: string;
  last?: MessageRow;
  unread: number;
}

export function titleFor(key: string, index?: ViewIndex): { title: string; subtitle: string } {
  if (key === GENERAL) return { title: 'Factory', subtitle: 'Everything not about one bead' };
  const ref = parseThreadKey(key);
  if (ref && 'bead' in ref) return { title: index?.byId.get(ref.bead)?.title ?? ref.bead, subtitle: ref.bead };
  if (ref && 'topic' in ref) return { title: ref.topic, subtitle: 'Topic' };
  return { title: key, subtitle: '' };
}

export function summariseThreads(messages: MessageRow[], index?: ViewIndex): ThreadSummary[] {
  const byKey = new Map<string, ThreadSummary>();
  byKey.set(GENERAL, { key: GENERAL, ...titleFor(GENERAL, index), unread: 0 });
  for (const row of messages) {
    const key = row.thread ?? GENERAL;
    const summary = byKey.get(key) ?? { key, ...titleFor(key, index), unread: 0 };
    if (!summary.last || row.ts >= summary.last.ts) summary.last = row;
    if (row.direction === 'received' && !row.read) summary.unread += 1;
    byKey.set(key, summary);
  }
  const general = byKey.get(GENERAL)!;
  const rest = [...byKey.values()].filter((summary) => summary.key !== GENERAL).sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
  return [general, ...rest];
}
