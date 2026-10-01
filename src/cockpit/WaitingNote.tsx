// src/cockpit/WaitingNote.tsx — what stands in for a one-tap button once the tap is on its way (oneTap.ts).
import { Icon } from '../ui';
import type { OutboxRow } from '../data/db';
import { FailedNote, OutboxMark } from './OutboxMark';

/** What stands in for the button while the factory has not yet answered; `pending` while the tap itself has not yet gone (mw-jrx0s.10),
 * `queued` its outbox row, which says what the backend said and offers Retry and Discard once it refused the tap (mw-jrx0s.21). */
export function WaitingNote({ className, pending, queued }: { className?: string; pending?: boolean; queued?: OutboxRow }) {
  if (queued?.state === 'failed') return <FailedNote id={queued.id as number} failure={queued.failure ?? 'The backend refused it.'} />;
  return (
    <span role="status" className={className ?? 'inline-flex items-center gap-1.5 text-[13px] text-muted'}>
      <Icon name="clock" size={15} />
      {pending ? 'Tapped' : 'Sent, waiting for the factory'}
      {pending && queued && <OutboxMark row={queued} />}
    </span>
  );
}
