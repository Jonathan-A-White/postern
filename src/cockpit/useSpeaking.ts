// src/cockpit/useSpeaking.ts — mw-ym1qi9.1: whether the speech started under `key` is reading
// now, so a speaker button can turn into Stop while it reads and back when it ends.
import { useSyncExternalStore } from 'react';
import { isSpeaking, subscribe } from '../services/speech';

export function useSpeaking(key: string): boolean {
  return useSyncExternalStore(subscribe, () => isSpeaking(key));
}
