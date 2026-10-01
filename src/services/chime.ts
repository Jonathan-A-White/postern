// src/services/chime.ts — a short, soft note and one buzz that say the Mayor is back.
// A phone without vibration or Web Audio, or one that refuses to sound without a tap,
// simply stays quiet: nothing here may break the screen.

/** One buzz and one soft note. */
export function chime(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(120);
  try {
    const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Context) return;
    const context = new Context();
    const note = context.createOscillator();
    const volume = context.createGain();
    note.frequency.value = 880;
    volume.gain.setValueAtTime(0.0001, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.4);
    note.connect(volume).connect(context.destination);
    note.start();
    note.stop(context.currentTime + 0.45);
    note.onended = () => void context.close();
  } catch {
    // no sound: the buzz was enough
  }
}
