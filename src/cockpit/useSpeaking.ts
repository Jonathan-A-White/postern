// src/cockpit/useSpeaking.ts — mw-ym1qi9.1: whether the speech started under `key` is reading
// now, so a speaker button can turn into Stop while it reads and back when it ends. A screen
// that is left stops the speech it started (mw-xhtcup.13); another speaker's speech is not touched.
import { useEffect, useSyncExternalStore } from 'react';
import { isSpeaking, stop, subscribe } from '../services/speech';

export function useSpeaking(key: string): boolean {
  useEffect(
    () => () => {
      if (isSpeaking(key)) stop();
    },
    [key],
  );
  return useSyncExternalStore(subscribe, () => isSpeaking(key));
}
