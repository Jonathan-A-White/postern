// src/cockpit/TodoDoneButton.tsx — the Done on a to do bead wherever it is opened outside the To do board
// (mw-ev7oyy.42): a close the Mayor applies, the same tap the board's check sends, so every copy on the
// screen shares one state (oneTap.ts) and none can be tapped again once it is on its way.
import { Button, Icon } from '../ui';
import { sendAction } from './send';
import { useOneTap } from './oneTap';
import { WaitingNote } from './WaitingNote';

export function TodoDoneButton({ bead, size = 'md' }: { bead: string; size?: 'sm' | 'md' }) {
  const close = useOneTap(bead, 'close');
  if (close.waiting && close.queued?.state === 'failed') return <WaitingNote pending={close.pending} queued={close.queued} />;
  if (close.waiting) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-muted">
        <Icon name="clock" size={15} />
        Done, waiting for the Mayor
      </span>
    );
  }
  return (
    <Button variant="primary" size={size} icon="check" onClick={() => void close.tap(() => sendAction({ action: 'close', bead }), `Marked ${bead} done`)}>
      Done
    </Button>
  );
}
