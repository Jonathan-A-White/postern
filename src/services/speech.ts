// src/services/speech.ts — mw-tfne4.6's Play control: reads a message or question
// aloud with the phone's own speechSynthesis (Web Speech API). Nothing here reaches
// the network — the text is only ever spoken locally.

import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';
import { recognizerLang } from './listen';

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// The phone's speech engine is shared by every app and keeps the last language used, so
// an utterance that names no language is read in whatever another app spoke last (a Greek
// voice reading English, mw-44omaq.7). Every utterance names its language, and a voice for
// it once the phone lists voices. A web app cannot read or restore the engine's own voice.
const tag = (lang: string): string => lang.replace(/_/g, '-').toLowerCase();

/** The language the app reads aloud in: the phone's, as a full tag (a bare 'en' becomes en-US). */
export function readingLang(): string {
  return recognizerLang(typeof navigator === 'undefined' ? undefined : navigator.language);
}

function preferredVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const want = tag(lang);
  const primary = want.split('-')[0];
  return (
    voices.find((voice) => tag(voice.lang) === want) ??
    voices.find((voice) => tag(voice.lang).split('-')[0] === primary)
  );
}

/** How long the first tap waits for the phone to list its voices before it speaks with the language alone. */
export const VOICES_WAIT_MS = 1000;

// A phone that listed no voices within the wait is not waited on again, so each tap is not slowed.
const gaveUpWaiting = new WeakSet<object>();

// What is spoken is not what is shown (mw-gq6.223): a bead id reads aloud letter by letter
// and a bare URL is noise on a train, so both are changed before speaking; the screen keeps
// its chips. A bead id is spoken as its title's short form when a lookup knows the title
// (mw-gq6.224) and is dropped when it does not. A text with neither is returned as it came.
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g;

/** Bead id -> full title, as a plain object or a Map. */
export type TitleLookup = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

const SHORT_TITLE_WORDS = 8;
const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** A title as it is said: bracket tags dropped, cut at the first ': ' (when two words stay), else 8 words. */
export function shortTitle(title: string): string {
  const bare = title.replace(/^(?:\s*\[[^\]]*\])+/, '').trim();
  const colon = bare.indexOf(': ');
  const head = colon >= 0 ? bare.slice(0, colon) : '';
  const cut = wordCount(head) >= 2 ? head : bare.split(/\s+/).slice(0, SHORT_TITLE_WORDS).join(' ');
  return cut.replace(/[.,;:\s]+$/, '');
}

function titleOf(titles: TitleLookup | undefined, id: string): string {
  if (!titles) return '';
  const found = titles instanceof Map ? titles.get(id) : (titles as Readonly<Record<string, string>>)[id];
  return typeof found === 'string' ? shortTitle(found) : '';
}

export function speechText(text: string, titles?: TitleLookup): string {
  let changed = false;
  let out = text.replace(new RegExp(BEAD_ID.source, 'g'), (match: string, offset: number) => {
    if (offset > 0 && WORD_CHAR.test(text[offset - 1])) return match;
    changed = true;
    return titleOf(titles, match);
  });
  out = out.replace(URL_RE, (match: string) => {
    changed = true;
    return /[.,;:!?]+$/.exec(match)?.[0] ?? '';
  });
  if (!changed) return text;
  return out
    .replace(/[([{][ \t]*[)\]}]/g, '') // brackets left empty
    .replace(/,[ \t]*(?:,[ \t]*)+/g, ', ') // 'a, , b' from two ids in a row
    .replace(/([:;(])[ \t]*,[ \t]*/g, '$1 ') // 'Running: , x' from a dropped first id
    .replace(/^[ \t]*,[ \t]*/gm, '') // a comma left at the start of a line
    .replace(/[ \t]+([,.;:!?])/g, '$1') // space left before punctuation
    .replace(/[:;,]+([ \t]*[.!?])/g, '$1') // 'Running now:.' -> 'Running now.'
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export interface SpeakOptions {
  onEnd?: () => void;
  /** Bead titles, so an id is said as its title (mw-gq6.224). */
  titles?: TitleLookup;
  /** Who started this speech, so that speaker's button can show Stop while it reads (mw-ym1qi9.1). */
  key?: string;
}

// Who is speaking now, as a tiny store a component reads with useSpeaking(key). A cancelled
// utterance reports its end late, after the next one began, so only the current utterance may clear it.
let speakingKey: string | null = null;
let current: SpeechSynthesisUtterance | null = null;
const listeners = new Set<() => void>();

function setSpeaking(key: string | null, utterance: SpeechSynthesisUtterance | null): void {
  if (key === speakingKey && utterance === current) return;
  speakingKey = key;
  current = utterance;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever who is speaking changes; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the speech started under `key` is reading. */
export function isSpeaking(key: string): boolean {
  return speakingKey === key;
}

// The speak still waiting for the voice list, so a stop or a newer speak can drop it.
let waiting: { cancel: () => void } | null = null;

function dropWaiting(): void {
  const pending = waiting;
  waiting = null;
  pending?.cancel();
}

/** Calls `ready` at once when voices are listed (or cannot be waited for), else once they load or the wait ends. */
function whenVoicesListed(synth: SpeechSynthesis, ready: () => void): void {
  if (synth.getVoices().length > 0 || typeof synth.addEventListener !== 'function' || gaveUpWaiting.has(synth)) {
    ready();
    return;
  }
  const done = () => {
    synth.removeEventListener('voiceschanged', onChanged);
    clearTimeout(timer);
    if (waiting === handle) waiting = null;
  };
  const onChanged = () => {
    if (synth.getVoices().length === 0) return;
    done();
    ready();
  };
  const handle = { cancel: done };
  waiting = handle;
  synth.addEventListener('voiceschanged', onChanged);
  const timer = setTimeout(() => {
    gaveUpWaiting.add(synth);
    done();
    ready();
  }, VOICES_WAIT_MS);
}

/** Cancels any utterance already speaking, then speaks `text` in the phone's language. */
export function speak(text: string, options: SpeakOptions = {}): void {
  const synth = window.speechSynthesis;
  dropWaiting();
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(speechText(text, options.titles));
  const lang = readingLang();
  utterance.lang = lang;
  const finished = () => {
    if (current === utterance) setSpeaking(null, null);
  };
  utterance.onend = () => {
    finished();
    options.onEnd?.();
  };
  utterance.onerror = finished;
  setSpeaking(options.key ?? null, utterance);
  whenVoicesListed(synth, () => {
    const voice = preferredVoice(synth.getVoices(), lang);
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  });
}

export function stop(): void {
  dropWaiting();
  setSpeaking(null, null);
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
}
