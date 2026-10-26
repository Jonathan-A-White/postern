// src/cockpit/OutboxNote.tsx — the status line's one line while anything he did has not yet gone
// (mw-jrx0s.10): nothing at all once the outbox is empty of pending rows. While the phone reaches
// the backend it says what truly holds the row (mw-gb92lmo), never that it waits to be back online.
import type { OutboxRow } from '../data/db';
import { Icon } from '../ui';
import { useNow } from '../ui/useNow';
import { isUnsent, outboxLine } from '../model/outbox';
import { useLive } from '../services/live';
import { useOutbox } from './hooks';

export function OutboxNote() {
  const rows = useOutbox();
  return rows.some(isUnsent) ? <OutboxLine rows={rows} /> : null;
}

/** Mounted only while a row is unsent, so the clock for its retry countdown runs only then. */
function OutboxLine({ rows }: { rows: OutboxRow[] }) {
  const status = useLive().status;
  const now = useNow(1000);
  const line = outboxLine(rows, now, status === 'live' || status === 'polling');
  if (!line) return null;
  return (
    <p role="status" aria-label="Outgoing" className="flex shrink-0 items-center justify-center gap-1.5 border-b border-line bg-surface px-3 py-1 text-[12.5px] text-muted">
      <Icon name="clock" size={13} />
      {line}
    </p>
  );
}
