// src/cockpit/WaitingNote.tsx — what stands in for a one-tap button once the tap is on its way (oneTap.ts).
import { Icon } from '../ui';
import { PendingMark } from './PendingMark';

/** What stands in for the button while the factory has not yet answered; `pending` while the tap itself has not yet gone (mw-jrx0s.10). */
export function WaitingNote({ className, pending }: { className?: string; pending?: boolean }) {
  return (
    <span role="status" className={className ?? 'inline-flex items-center gap-1.5 text-[13px] text-muted'}>
      <Icon name="clock" size={15} />
      {pending ? 'Tapped' : 'Sent, waiting for the factory'}
      {pending && <PendingMark />}
    </span>
  );
}
