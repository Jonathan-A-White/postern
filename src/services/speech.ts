// src/services/speech.ts — mw-tfne4.6's Play control: reads a message or question
// aloud with the phone's own speechSynthesis (Web Speech API). Nothing here reaches
// the network — the text is only ever spoken locally.

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function preferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const lang = navigator.language;
  return (
    voices.find((voice) => voice.lang === lang) ??
    voices.find((voice) => voice.lang.split('-')[0] === lang.split('-')[0])
  );
}

export interface SpeakOptions {
  onEnd?: () => void;
}

/** Cancels any utterance already speaking, then speaks `text`. */
export function speak(text: string, options: SpeakOptions = {}): void {
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = preferredVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  if (options.onEnd) utterance.onend = options.onEnd;
  synth.speak(utterance);
}

export function stop(): void {
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
}
