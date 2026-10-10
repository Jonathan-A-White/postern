// src/cockpit/ChaseChoice.tsx — Chase, Done or Keep waiting for a chase need
// (docs/protocol.md §11, §13): a bead the factory asked somebody else about has
// gone three working days unchanged. Each is one tap that sends one action
// (oneTap.ts) and then waits for the factory's next view; the three are one
// choice, so once any is on its way none can be tapped again.
import { Button } from '../ui';
import { CHASE_ACTIONS, CHASE_OPTIONS } from '../model/needs';
import { sendAction, useSend } from './send';
import { useOneTap } from './oneTap';
import { WaitingNote } from './WaitingNote';

const TOAST: Record<string, (bead: string) => string> = {
  Chase: (bead) => `Told the factory you are chasing ${bead}`,
  Done: (bead) => `Marked ${bead} done: no longer waiting on others`,
  'Keep waiting': (bead) => `Waiting on ${bead} for three more working days`,
};

export function ChaseChoice({ bead, size }: { bead: string; size?: 'sm' }) {
  const { busy } = useSend();
  const taps = {
    Chase: useOneTap(bead, CHASE_ACTIONS.Chase),
    Done: useOneTap(bead, CHASE_ACTIONS.Done),
    'Keep waiting': useOneTap(bead, CHASE_ACTIONS['Keep waiting']),
  };
  const sent = Object.values(taps).find((tap) => tap.waiting);
  if (sent) return <WaitingNote pending={sent.pending} queued={sent.queued} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
        {CHASE_OPTIONS.map((option, at) => (
          <Button
            key={option}
            size={size}
            variant={at === 0 ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void taps[option as keyof typeof taps].tap(() => sendAction({ action: CHASE_ACTIONS[option], bead }), TOAST[option](bead))}
          >
            {option}
          </Button>
        ))}
      </div>
      <p className="text-[12.5px] text-muted">Chase: you are nudging them now. Done: they delivered. Keep waiting: ask again in three working days.</p>
    </div>
  );
}
