// src/cockpit/PendingMark.tsx — what a card, bubble or turn wears while what he did on it waits in
// the outbox (mw-jrx0s.10).
import { Icon, cx } from '../ui';

export function PendingMark({ className }: { className?: string }) {
  return (
    <span data-testid="pending-mark" className={cx('inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[11px] font-medium text-muted', className)}>
      <Icon name="clock" size={11} />
      pending
    </span>
  );
}
