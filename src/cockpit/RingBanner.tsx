// src/cockpit/RingBanner.tsx — the Mayor's ring when the phone could not raise a notification
// (docs/protocol.md §21): a banner over whatever he is on, with Answer (the Talk line, naming the
// ring) and a way to put it off. The ring itself stays on the Talk line as a missed call.
import { Banner, Button } from '../ui';
import { navigate } from '../router';
import { dismissIncomingRing, useIncomingRing } from '../services/ringIn';

export function RingBanner() {
  const ring = useIncomingRing();
  if (!ring) return null;
  return (
    <section role="alert" aria-label="The Mayor is calling" className="shrink-0 px-2 pt-2">
      <Banner
        tone="needs"
        icon="talk"
        action={
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                dismissIncomingRing();
                navigate({ view: 'line', call: ring.txid });
              }}
            >
              Answer
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissIncomingRing}>
              Dismiss
            </Button>
          </span>
        }
      >
        <span className="flex flex-col">
          <span className="font-medium">The Mayor is calling</span>
          {ring.reason && <span className="break-words">{ring.reason}</span>}
        </span>
      </Banner>
    </section>
  );
}
