// src/speech/PlaySpeech.tsx — mw-tfne4.6's Play/Stop control, shared by the inbox
// and the Question screen. Hidden when the phone has no speech synthesis; a second
// tap, or leaving the screen (effect cleanup), stops it.
import { useEffect, useState } from 'react';
import { isSupported, speak, stop } from '../services/speech';

export interface PlaySpeechProps {
  text: string;
}

export function PlaySpeech({ text }: PlaySpeechProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => stop, []);

  if (!isSupported()) return null;

  function handleClick() {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
    speak(text, { onEnd: () => setPlaying(false) });
    setPlaying(true);
  }

  return (
    <button type="button" className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={handleClick}>
      {playing ? 'Stop' : 'Play'}
    </button>
  );
}
