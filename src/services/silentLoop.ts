// src/services/silentLoop.ts — a silent audio element looped while a talk is open
// (mw-j0f2d.29). A page that is playing audio is the one Android is least willing to
// suspend, so this is the try at keeping the Talk line's voice alive with the screen
// off, beside the wake lock. Its samples are all zero, so nothing is audible; a browser that refuses (no
// gesture yet, no Audio) just goes without: nothing here may break a talk.

const SAMPLE_RATE = 8000;
const SAMPLES = 800; // 0.1 s of silence, looped

/** A 16-bit mono PCM WAV of silence, as a data: URL. */
export function silentWavUrl(): string {
  const bytes = new Uint8Array(44 + SAMPLES * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + SAMPLES * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, SAMPLES * 2, true);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Plays silence on a loop until the returned function is called. */
export function holdVoiceAlive(): () => void {
  if (typeof Audio === 'undefined') return () => undefined;
  let element: HTMLAudioElement | undefined;
  try {
    element = new Audio(silentWavUrl());
    element.loop = true;
    void Promise.resolve(element.play()).catch(() => undefined);
  } catch {
    return () => undefined;
  }
  const playing = element;
  return () => {
    try {
      playing.pause();
    } catch {
      // already gone
    }
  };
}
