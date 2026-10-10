// src/services/speech.ts — mw-tfne4.6's Play control: reads a message or question aloud with the phone's own
// speechSynthesis. The engine (sentence queue, Pause/Resume/Restart/Stop that keep the place, the language and voice of
// each utterance) is bsv-kit's packages/speech (mw-m7v5kc.2); this file is what is Postern's own: the Talk line's key and
// a bead id said as its title. Nothing here reaches the network — the text is only ever spoken locally.
import { speak as speakAloud, type SpeakOptions as KitSpeakOptions } from 'bsv-kit/speech';
import { BEAD_ID, WORD_CHAR } from '../markdown/beadLinks';

export {
  getSpeech,
  isPausedOn,
  isSpeaking,
  isSupported,
  pause,
  readingLang,
  restart,
  resume,
  sentencesOf,
  stop,
  subscribe,
  VOICES_WAIT_MS,
  whenDone,
  type SpeechState,
  type SpeechStatus,
} from 'bsv-kit/speech';

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

export interface SpeakOptions extends Omit<KitSpeakOptions, 'prepare'> {
  /** Bead titles, so an id is said as its title (mw-gq6.224). */
  titles?: TitleLookup;
}

/** The key the Talk line speaks the Mayor's answer under: the Talk line draws that speech's bar itself, since its buttons also steer the line. */
export const TALK_ANSWER_KEY = 'talk-answer';

/** Cancels any speech, then speaks `text` in the phone's language, its bead ids and links changed into what is said. */
export function speak(text: string, options: SpeakOptions = {}): void {
  const { titles, ...rest } = options;
  speakAloud(text, { ...rest, prepare: (shown) => speechText(shown, titles) });
}
