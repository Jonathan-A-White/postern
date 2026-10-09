// src/cockpit/useSpeaking.ts — mw-ym1qi9.1: whether the speech started under `key` is reading
// now, so a speaker button can turn into Stop while it reads and back when it ends. A screen
// that is left stops the speech it started (mw-xhtcup.13); another speaker's speech is not touched.
// A speech that is paused still counts as his: its button says Stop, and the speaking bar offers Resume.
import { useEffect, useSyncExternalStore } from 'react';
import { getSpeech, isSpeaking, stop, subscribe, type SpeechState } from '../services/speech';

export function useSpeaking(key: string): boolean {
  useEffect(
    () => () => {
      if (isSpeaking(key)) stop();
    },
    [key],
  );
  return useSyncExternalStore(subscribe, () => isSpeaking(key));
}

/** What is speaking now (mw-q6n8m0.9): whose, whether it plays or is paused, and the sentence reached. */
export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribe, getSpeech);
}
