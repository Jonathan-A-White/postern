// src/cockpit/NoPosts.tsx — what a channel with no posts says, by how far the thread read has got.
import { EmptyState, Spinner } from '../ui';
import type { ThreadRead } from './hooks';

/** What a channel with no posts says: never "nothing" before the phone has read it and the backend has answered (mw-gq6.898). `hint` is the line under the empty title,
 * for a channel that has something more particular to say (a prompt's, mw-gq6.910). */
export function NoPosts({ read, hint = 'Say anything; the Mayor answers in its thread.' }: { read: ThreadRead; hint?: string }) {
  if (read === 'reading') {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
        <Spinner size={14} />
        Reading this channel…
      </p>
    );
  }
  if (read === 'failed') {
    return (
      <EmptyState icon="talk" title="Couldn't read this channel on the phone">
        The phone's own copy would not open. It is trying again, and the posts appear here when it does.
      </EmptyState>
    );
  }
  if (read === 'unreached') {
    return (
      <EmptyState icon="talk" title="Can't reach the Mayor yet">
        This channel may have posts the phone has not fetched. It keeps trying, and they appear here when the line is back.
      </EmptyState>
    );
  }
  return <EmptyState icon="talk" title="Nothing said here yet">{hint}</EmptyState>;
}
