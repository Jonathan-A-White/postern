// src/cockpit/VerifiedButton.tsx — the one Verified button (mw-581qad.1): on a verify card in Needs you
// (ready or waiting on the Mayor), on the bead's page and anywhere else he can say he checked it.
// One tap asks "Mark <bead> verified?", Yes sends a channel message that begins VERIFIED and says where
// it was tapped. Every copy on the screen shares one state (oneTap.ts), so once it is on its way they
// all say so and none can be tapped again.
import { useEffect, useState } from 'react';
import { Button } from '../ui';
import { threadKey } from '../services/threads';
import type { VerifiedWhere } from '../model/verified';
import { useOneTap } from './oneTap';
import { sendVerified } from './send';
import { WaitingNote } from './WaitingNote';

/** How long the question stays up untouched before the button folds back. */
const CONFIRM_MS = 8_000;

export function VerifiedButton({ bead, where, size = 'md' }: { bead: string; where: VerifiedWhere; size?: 'sm' | 'md' }) {
  const oneTap = useOneTap(bead, 'verified');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (oneTap.waiting) return <WaitingNote pending={oneTap.pending} queued={oneTap.queued} />;

  if (!confirming) {
    return (
      <Button variant="primary" size={size} icon="check" onClick={() => setConfirming(true)}>
        Verified
      </Button>
    );
  }

  function yes() {
    setConfirming(false);
    void oneTap.tap(() => sendVerified(bead, where), { text: `Marked ${bead} verified`, open: { view: 'talk', thread: threadKey({ bead }) ?? bead } });
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" role="group" aria-label="Confirm verified">
      <p className="text-[13px] text-muted">Mark {bead} verified? The Mayor is told you checked it and it works.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size={size} icon="check" onClick={yes}>
          Yes, verified
        </Button>
        <Button variant="ghost" size={size} onClick={() => setConfirming(false)}>
          Not yet
        </Button>
      </div>
    </div>
  );
}
