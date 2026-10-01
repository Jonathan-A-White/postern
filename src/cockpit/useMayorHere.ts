// src/cockpit/useMayorHere.ts — asks the backend whether the Mayor is here
// (src/services/presence.ts) every few seconds while the screen is open, and at once
// when the phone comes back to the foreground. undefined until the backend has said.
import { useEffect, useState } from 'react';
import { fetchMayorHere } from '../services/presence';
import { useUnlockedKey } from './hooks';

export const PRESENCE_POLL_MS = 5_000;

export function useMayorHere(): boolean | undefined {
  const key = useUnlockedKey();
  const [here, setHere] = useState<boolean | undefined>();
  useEffect(() => {
    if (!key) return;
    let current = true;
    const ask = () => {
      void fetchMayorHere(key).then((answer) => {
        // A failed ask leaves what the screen last knew.
        if (current && answer !== undefined) setHere(answer);
      });
    };
    ask();
    const timer = setInterval(ask, PRESENCE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
  return here;
}
