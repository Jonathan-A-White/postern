// src/model/generalThreads.ts — docs/protocol.md §14: in the General thread a plain
// text message whose `re` names another General message is a REPLY in that
// message's thread. The thread's root is the named message, or that message's own
// root if it is itself a reply: one level deep, however long the chain. A message
// whose `re` names a txid that is not here stays a root, and a transcript or a
// grist answer is an annotation, never a reply.
import type { ConversationItem } from './conversation';

export interface GeneralThread {
  root: ConversationItem;
  /** Oldest first. */
  replies: ConversationItem[];
  replyCount: number;
  /** Milliseconds since the epoch; absent when there are no replies. */
  lastReplyAt?: number;
}

/** The txid a plain text message answers, lower-cased; undefined for anything else. */
function repliedTo(item: ConversationItem): string | undefined {
  if (item.source !== 'message' || item.kind !== 'text' || item.re === undefined) return undefined;
  return item.re.toLowerCase();
}

/** The merged General conversation as its roots in time order, each with its
 * replies in time order. */
export function groupGeneral(items: ConversationItem[]): GeneralThread[] {
  const ordered = [...items].sort((a, b) => a.at - b.at);
  const byTxid = new Map<string, ConversationItem>();
  for (const item of ordered) if (item.txid) byTxid.set(item.txid.toLowerCase(), item);

  /** The item's root, or the item itself when it is one (or its re names a loop). */
  const rootOf = (item: ConversationItem): ConversationItem => {
    const seen = new Set<ConversationItem>([item]);
    let current = item;
    for (;;) {
      const target = repliedTo(current);
      const next = target === undefined ? undefined : byTxid.get(target);
      if (next === undefined) return current;
      if (seen.has(next)) return item;
      seen.add(next);
      current = next;
    }
  };

  const threads = new Map<ConversationItem, GeneralThread>();
  const order: GeneralThread[] = [];
  const threadOf = (root: ConversationItem): GeneralThread => {
    let thread = threads.get(root);
    if (!thread) {
      thread = { root, replies: [], replyCount: 0 };
      threads.set(root, thread);
      order.push(thread);
    }
    return thread;
  };

  for (const item of ordered) {
    const root = rootOf(item);
    if (root === item) {
      threadOf(item);
      continue;
    }
    const thread = threadOf(root);
    thread.replies.push(item);
    thread.replyCount = thread.replies.length;
    thread.lastReplyAt = item.at;
  }
  return order;
}
