// src/model/postThreads.ts — docs/protocol.md §14: in any channel (General, a
// bead's, a named one) a text message, or one carrying files, whose `re` names another message of
// that channel is a REPLY in that message's thread. The thread's root is the named message, or that message's own
// root if it is itself a reply: one level deep, however long the chain. A message
// whose `re` names a txid that is not here stays a root, and a transcript or a
// grist answer is an annotation, never a reply. A bead's comment has no txid: it
// is always a post, never a reply and never replied to.
import type { ConversationItem } from './conversation';

export interface PostThread {
  root: ConversationItem;
  /** Oldest first. */
  replies: ConversationItem[];
  replyCount: number;
  /** Milliseconds since the epoch; absent when there are no replies. */
  lastReplyAt?: number;
}

/** The txid a text message or one carrying files answers, lower-cased; undefined for anything else. */
function repliedTo(item: ConversationItem): string | undefined {
  if (item.source !== 'message' || (item.kind !== 'text' && item.kind !== 'attachment') || item.re === undefined) return undefined;
  return item.re.toLowerCase();
}

/** One channel's merged conversation as its roots in time order, each with its
 * replies in time order. */
export function groupPosts(items: ConversationItem[]): PostThread[] {
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

  const threads = new Map<ConversationItem, PostThread>();
  const order: PostThread[] = [];
  const threadOf = (root: ConversationItem): PostThread => {
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
