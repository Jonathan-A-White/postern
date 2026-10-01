// src/services/speech.ts — mw-tfne4.6's Play control: reads a message or question
// aloud with the phone's own speechSynthesis (Web Speech API). Nothing here reaches
// the network — the text is only ever spoken locally.

import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';

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

// What is spoken is not what is shown (mw-gq6.223): a bead id reads aloud letter by letter
// and a bare URL is noise on a train, so both are dropped before speaking; the screen keeps
// its chips. A text with neither is returned exactly as it came.
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g;

export function speechText(text: string): string {
  let dropped = false;
  let out = text.replace(new RegExp(BEAD_ID.source, 'g'), (match: string, offset: number) => {
    if (offset > 0 && WORD_CHAR.test(text[offset - 1])) return match;
    dropped = true;
    return '';
  });
  out = out.replace(URL_RE, (match: string) => {
    dropped = true;
    return /[.,;:!?]+$/.exec(match)?.[0] ?? '';
  });
  if (!dropped) return text;
  return out
    .replace(/[([{][ \t]*[)\]}]/g, '') // brackets left empty
    .replace(/,[ \t]*(?:,[ \t]*)+/g, ', ') // 'a, , b' from two ids in a row
    .replace(/[ \t]+([,.;:!?])/g, '$1') // space left before punctuation
    .replace(/[:;,]+([ \t]*[.!?])/g, '$1') // 'Running now:.' -> 'Running now.'
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export interface SpeakOptions {
  onEnd?: () => void;
}

/** Cancels any utterance already speaking, then speaks `text`. */
export function speak(text: string, options: SpeakOptions = {}): void {
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(speechText(text));
  const voice = preferredVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  if (options.onEnd) utterance.onend = options.onEnd;
  synth.speak(utterance);
}

export function stop(): void {
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
}
