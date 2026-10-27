// src/cockpit/PendingMark.tsx — what a card, bubble or turn wears while what he did on it waits in
// the outbox (mw-jrx0s.10).
import { Icon, cx } from '../ui';

export function PendingMark({ className, onClick }: { className?: string; onClick?: () => void }) {
  const look = cx('inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[11px] font-medium text-muted', className);
  // A tap on the mark says why the row waits, and offers Retry now and Discard (mw-o14xubc).
  if (onClick) {
    return (
      <button type="button" data-testid="pending-mark" aria-label="Pending: tap for why" className={cx(look, 'hover:text-fg')} onClick={onClick}>
        <Icon name="clock" size={11} />
        pending
      </button>
    );
  }
  return (
    <span data-testid="pending-mark" className={look}>
      <Icon name="clock" size={11} />
      pending
    </span>
  );
}
