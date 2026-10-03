// src/cockpit/useMayorHere.ts — asks the backend whether the Mayor is here
// (src/services/presence.ts): every 5 s while the line waits for his answer, every 30 s
// otherwise, never while the page is hidden, and at once when the phone comes back to the
// foreground. undefined until the backend has said (mw-1ox07o.4).
import { useEffect, useState } from 'react';
import { fetchMayorHere } from '../services/presence';
import { useUnlockedKey } from './hooks';

export const PRESENCE_POLL_MS = 5_000;
export const PRESENCE_IDLE_POLL_MS = 30_000;

/** `waiting`: the Talk line is waiting for the Mayor's answer, so whether he is here is worth knowing quickly. */
export function useMayorHere(waiting = false): boolean | undefined {
  const key = useUnlockedKey();
  const [here, setHere] = useState<boolean | undefined>();
  useEffect(() => {
    if (!key) return;
    let current = true;
    const ask = () => {
      if (document.visibilityState === 'hidden') return;
      void fetchMayorHere(key).then((answer) => {
        // A failed ask leaves what the screen last knew.
        if (current && answer !== undefined) setHere(answer);
      });
    };
    ask();
    const timer = setInterval(ask, waiting ? PRESENCE_POLL_MS : PRESENCE_IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, waiting]);
  return here;
}
