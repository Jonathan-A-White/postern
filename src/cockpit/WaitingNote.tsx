// src/cockpit/WaitingNote.tsx — what stands in for a one-tap button once the tap is on its way (oneTap.ts).
import { Icon } from '../ui';

/** What stands in for the button while the factory has not yet answered. */
export function WaitingNote({ className }: { className?: string }) {
  return (
    <span role="status" className={className ?? 'inline-flex items-center gap-1.5 text-[13px] text-muted'}>
      <Icon name="clock" size={15} />
      Sent, waiting for the factory
    </span>
  );
}
