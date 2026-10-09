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
  /** Carry on from the kept sentence when this same key and text were paused, handing the speech this `onEnd`; otherwise start at the top. */
  resumeIfPaused?: boolean;
}

/** The key the Talk line speaks the Mayor's answer under: the Talk line draws that speech's bar itself, since its buttons also steer the line. */
export const TALK_ANSWER_KEY = 'talk-answer';

export type SpeechStatus = 'idle' | 'playing' | 'paused';

/** What is speaking now: whose it is, whether it plays or waits paused, and the sentence reached of the sentences it has. */
export interface SpeechState {
  status: SpeechStatus;
  key: string | null;
  index: number;
  count: number;
}

const IDLE: SpeechState = { status: 'idle', key: null, index: 0, count: 0 };

// What is spoken is split into sentences, queued on the synthesiser at once (so every speak() still
// runs inside the tap) and tracked by each one's start and end: the sentence reached is the position a
// pause keeps. Pausing cancels the queue and Resume queues the sentences from the kept one, because
// Android Chrome does not honour speechSynthesis.pause()/resume() (mw-q6n8m0.9). A cancelled utterance
// reports its end late, after the next speech began, so every utterance belongs to an epoch and only the
// current epoch may move the position or end the speech.
interface Reading {
  key: string | null;
  source: string;
  sentences: string[];
  index: number;
  status: 'playing' | 'paused';
  onEnd?: () => void;
}

let reading: Reading | null = null;
let epoch = 0;
let snapshot: SpeechState = IDLE;
const listeners = new Set<() => void>();

function publish(): void {
  const next: SpeechState = reading ? { status: reading.status, key: reading.key, index: reading.index, count: reading.sentences.length } : IDLE;
  if (next.status === snapshot.status && next.key === snapshot.key && next.index === snapshot.index && next.count === snapshot.count) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever what is speaking changes; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What is speaking now; the same object until it changes, so a component may read it with useSyncExternalStore. */
export function getSpeech(): SpeechState {
  return snapshot;
}

/** True while the speech started under `key` is reading or paused (a paused one is still his to Resume or Stop). */
export function isSpeaking(key: string): boolean {
  return reading?.key === key;
}

/** `text` as sentences: cut after . ! ? or an ellipsis followed by a space, and at line ends. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?\u2026])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
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

/** Queues `reading`'s sentences from its position, once the phone's voices are listed. */
function play(synth: SpeechSynthesis, current: Reading): void {
  const mine = epoch;
  const lang = readingLang();
  whenVoicesListed(synth, () => {
    if (mine !== epoch) return;
    const voice = preferredVoice(synth.getVoices(), lang);
    for (let i = current.index; i < current.sentences.length; i += 1) {
      const utterance = new SpeechSynthesisUtterance(current.sentences[i]);
      utterance.lang = lang;
      if (voice) utterance.voice = voice;
      const reached = (index: number) => {
        if (mine !== epoch || index <= current.index) return;
        current.index = index;
        publish();
      };
      utterance.onstart = () => reached(i);
      utterance.onend = () => {
        if (mine !== epoch) return;
        if (i < current.sentences.length - 1) {
          reached(i + 1);
          return;
        }
        reading = null;
        publish();
        current.onEnd?.();
      };
      utterance.onerror = () => {
        if (mine !== epoch) return;
        reading = null;
        publish();
      };
      synth.speak(utterance);
    }
  });
}

/** Cancels any utterance already speaking, then speaks `text` in the phone's language. */
export function speak(text: string, options: SpeakOptions = {}): void {
  const synth = window.speechSynthesis;
  const key = options.key ?? null;
  const spoken = speechText(text, options.titles);
  dropWaiting();
  epoch += 1;
  if (options.resumeIfPaused && reading?.status === 'paused' && reading.key === key && reading.source === spoken) {
    reading.status = 'playing';
    reading.onEnd = options.onEnd;
    publish();
    synth.cancel();
    play(synth, reading);
    return;
  }
  synth.cancel();
  const sentences = sentencesOf(spoken);
  reading = { key, source: spoken, sentences: sentences.length > 0 ? sentences : [spoken], index: 0, status: 'playing', onEnd: options.onEnd };
  publish();
  play(synth, reading);
}

/** Pauses what is speaking where it is: the sentence reached is kept for resume(). */
export function pause(): void {
  if (reading?.status !== 'playing') return;
  dropWaiting();
  epoch += 1;
  reading.status = 'paused';
  publish();
  if (isSupported()) window.speechSynthesis.cancel();
}

/** Speaks on from the sentence a pause kept. */
export function resume(): void {
  if (reading?.status !== 'paused' || !isSupported()) return;
  epoch += 1;
  reading.status = 'playing';
  publish();
  play(window.speechSynthesis, reading);
}

/** Speaks the same text again from its first sentence, whether it plays or is paused. */
export function restart(): void {
  if (!reading || !isSupported()) return;
  dropWaiting();
  epoch += 1;
  reading.index = 0;
  reading.status = 'playing';
  publish();
  window.speechSynthesis.cancel();
  play(window.speechSynthesis, reading);
}

export function stop(): void {
  dropWaiting();
  epoch += 1;
  reading = null;
  publish();
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
}

// A page that goes hidden pauses what it is saying (Android suspends its voice anyway); coming back
// leaves it paused, for him to Resume where it stopped.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
  });
}
