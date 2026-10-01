// src/cockpit/RepliesRow.tsx — the 'N replies' row under a post that has replies, in
// every channel and on the bead page (docs/protocol.md §14, mw-909ci.2): a link to
// that post's thread in the channel it was said in.
import { Icon, TimeAgo } from '../ui';
import { formatRoute } from '../nav/route';
import type { PostThread } from '../model/postThreads';

export function RepliesRow({ channel, thread }: { channel: string; thread: PostThread }) {
  const fresh = thread.replies.some((reply) => reply.unread);
  return (
    <a
      href={formatRoute({ view: 'talk', thread: channel, root: thread.root.txid })}
      className="flex items-center gap-1.5 self-start px-1 text-[12.5px] font-semibold text-accent hover:underline"
    >
      <Icon name="talk" size={13} />
      {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
      <span className="font-normal text-faint">·</span>
      <TimeAgo at={thread.lastReplyAt} className="font-normal text-faint" />
      {fresh && <span className="text-accent">· new</span>}
    </a>
  );
}
