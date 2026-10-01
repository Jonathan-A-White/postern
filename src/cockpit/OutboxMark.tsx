// src/cockpit/OutboxMark.tsx — what a card, bubble or turn wears for what he did on it that has not
// gone: the pending mark while it waits its turn, and once the backend has refused it for good
// (mw-jrx0s.21) what the backend said, with Retry and Discard. The queue has moved on either way.
import { discardRow, retryRow } from '../services/outbox';
import type { OutboxRow } from '../data/db';
import { Button } from '../ui';
import { PendingMark } from './PendingMark';

export function FailedNote({ id, failure, className }: { id: number; failure: string; className?: string }) {
  return (
    <span data-testid="failed-note" role="alert" className={className ?? 'inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-danger'}>
      <span className="min-w-0 break-words">Not sent: {failure}</span>
      <Button size="sm" variant="secondary" onClick={() => void retryRow(id)}>
        Retry
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void discardRow(id)}>
        Discard
      </Button>
    </span>
  );
}

/** The pending mark for a row that waits to go, or the refusal with Retry and Discard for one the backend refused. */
export function OutboxMark({ row, className }: { row: Pick<OutboxRow, 'id' | 'state' | 'failure'>; className?: string }) {
  if (row.state === 'failed') return <FailedNote id={row.id as number} failure={row.failure ?? 'The backend refused it.'} />;
  return <PendingMark className={className} />;
}
