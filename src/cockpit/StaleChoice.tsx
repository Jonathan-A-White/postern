// src/cockpit/StaleChoice.tsx — Keep or Close for a bead that has gone stale
// (docs/protocol.md §11, §13). Keep is one tap; Close asks once, because it
// closes the bead and its held stories. Either sends once (oneTap.ts) and then
// waits for the factory's next view.
import { useState } from 'react';
import { Button } from '../ui';
import { sendAction, useSend } from './send';
import { useOneTap } from './oneTap';
import { WaitingNote } from './WaitingNote';

export function StaleChoice({ bead, size }: { bead: string; size?: 'sm' }) {
  const { busy } = useSend();
  const keep = useOneTap(bead, 'keep');
  const close = useOneTap(bead, 'close');
  const [asking, setAsking] = useState(false);

  if (keep.waiting || close.waiting) return <WaitingNote />;

  if (asking) {
    return (
      <div className="flex flex-col gap-2" role="group" aria-label="Close this bead?">
        <p className="text-[14px] font-medium">Close {bead} and its held stories?</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size={size ?? 'sm'}
            variant="primary"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              void close.tap(() => sendAction({ action: 'close', bead }), `Closed ${bead}`);
            }}
          >
            Close
          </Button>
          <Button size={size ?? 'sm'} variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
      <Button size={size} variant="primary" disabled={busy} onClick={() => void keep.tap(() => sendAction({ action: 'keep', bead }), `Kept ${bead}`)}>
        Keep
      </Button>
      <Button size={size} variant="secondary" disabled={busy} onClick={() => setAsking(true)}>
        Close
      </Button>
    </div>
  );
}
