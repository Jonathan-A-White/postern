// src/cockpit/usePrompts.ts — the saved prompts for a screen: what the phone last kept
// (src/services/prompts.ts, read live from Dexie so it shows at once and offline), and
// one ask of the backend on open and whenever the phone comes back to the foreground.
// `fresh` is true once the backend has answered this time, false once it has not.
import { useEffect, useState } from 'react';
import { settingsRepo } from '../data/repositories';
import type { Prompt } from '../data/db';
import { fetchPrompts } from '../services/prompts';
import { useLiveQuery, useUnlockedKey } from './hooks';

export interface PromptsState {
  /** undefined until the phone has either kept a list or heard there is none to be had. */
  prompts: Prompt[] | undefined;
  /** When the list was fetched (ms), if the phone holds one. */
  at: number | undefined;
  /** undefined while the first ask is out; then whether the backend answered. */
  fresh: boolean | undefined;
  /** Asks the backend again (the screen's Try again). */
  retry: () => void;
}

/** `enabled` false keeps it to what the phone holds (the composer asks only once he types '/'). */
export function usePrompts(enabled = true): PromptsState {
  const key = useUnlockedKey();
  const cache = useLiveQuery(() => settingsRepo.getPromptsCache().then((row) => row ?? null), [], undefined);
  const [fresh, setFresh] = useState<boolean | undefined>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key || !enabled) return;
    let current = true;
    const ask = () => {
      void fetchPrompts(key).then((answer) => {
        if (current) setFresh(answer !== undefined);
      });
    };
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, enabled, attempt]);
  const retry = () => {
    setFresh(undefined);
    setAttempt((n) => n + 1);
  };
  return { prompts: cache?.prompts, at: cache?.at, fresh, retry };
}
