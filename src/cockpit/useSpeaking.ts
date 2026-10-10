// src/cockpit/useSpeaking.ts — mw-ym1qi9.1: whether the speech started under `key` is reading
// now, so a speaker button can turn into Stop while it reads and back when it ends. A screen
// that is left pauses the speech it started (his words, mw-q6n8m0.10): the Shell's speaking bar offers Resume on the
// next screen and the button says Stop again when he comes back; only a new speech or Stop ends it. Another speaker's
// speech is not touched. A speech that is paused still counts as his: its button says Stop, and the bar offers Resume.
import { useEffect, useSyncExternalStore } from 'react';
import { getSpeech, isSpeaking, pause, subscribe, type SpeechState } from '../services/speech';

export function useSpeaking(key: string): boolean {
  useEffect(
    () => () => {
      if (isSpeaking(key)) pause();
    },
    [key],
  );
  return useSyncExternalStore(subscribe, () => isSpeaking(key));
}

/** What is speaking now (mw-q6n8m0.9): whose, whether it plays or is paused, and the sentence reached. */
export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribe, getSpeech);
}
