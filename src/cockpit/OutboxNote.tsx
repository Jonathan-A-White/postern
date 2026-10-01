// src/cockpit/OutboxNote.tsx — the status line's one line while anything he did has not yet gone
// (mw-jrx0s.10): nothing at all once the outbox is empty of pending rows.
import { Icon } from '../ui';
import { SENDING_WHEN_BACK, anyPending } from '../model/outbox';
import { useOutbox } from './hooks';

export function OutboxNote() {
  const waiting = anyPending(useOutbox());
  if (!waiting) return null;
  return (
    <p role="status" aria-label="Outgoing" className="flex shrink-0 items-center justify-center gap-1.5 border-b border-line bg-surface px-3 py-1 text-[12.5px] text-muted">
      <Icon name="clock" size={13} />
      {SENDING_WHEN_BACK}
    </p>
  );
}
