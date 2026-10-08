// src/services/listen.ts — the dictation twin of speech.ts: wraps the browser's
// SpeechRecognition (webkit-prefixed on Safari and older Chrome). Start it when the
// person presses and holds, stop it on release. It asks for on-device recognition
// where the browser offers it and says which mode it ended up in, because in cloud
// mode the browser sends the audio to its vendor's speech service. Support is
// detected without throwing, and every failure comes back as a value. The recogniser
// is not trusted: the mic counts as open only when it says so (onstart/onaudiostart),
// its errors are passed on, a stop() that never gets an onend gives up after
// STOP_TIMEOUT_MS, and an on-device attempt the phone cannot do is retried once in
// network mode within the same hold. The recogniser also ends itself while the finger
// is down (Android Chrome on a pause or a no-speech/network blip): until stop() the
// hold goes on, the recogniser is started again and the earlier words are kept; only a
// recogniser that keeps ending at once is given up on, never one that lasted through a pause
// (mw-j0f2d.27), and never once he has said words: then it is given a moment and started again
// until he lets go, and a phrase the restarted recogniser hears again is said once (mw-j0f2d.37).
// The recogniser always gets a full language tag (en-US when none is given, a bare 'en'
// widened to it), and a language-not-supported error is retried once with en-US
// before it is shown, because the phone's service rejects tags it has no pack for.
// The recogniser listens on the phone's default microphone unless it is handed an audio
// track (start(track), Chrome): when the caller can open a Bluetooth input (a car's
// hands-free microphone, see micInput.ts) the hold waits for it, starts the recogniser
// on that track, says which input it chose, and goes back to the default microphone
// if the track is refused or the recogniser finds no capture device on it, or if a stretch
// of the hold ends with no result at all on it (earbuds whose microphone is not routed hear
// nothing and raise no error): the hold goes on on the default microphone and the input is
// marked silent, so the page does not choose it again. An input that gave any words is kept (mw-j0f2d.34).
// The hold does not wait for that stretch to end: an input that gives no result within INPUT_SILENT_MS of
// the recogniser starting on it is given up on there and then, and a fresh recogniser goes on on the
// default microphone while he still holds (mw-f7gmps.1).

/** The language the recogniser is asked for when the page names none, and the one it falls back to. */
export const DEFAULT_LANG = 'en-US';

/** A full tag for the recogniser: nothing or a bare 'en' becomes en-US; any other tag is kept as given. */
export function recognizerLang(lang: string | undefined): string {
  const tag = lang?.trim().replace(/_/g, '-');
  if (!tag || tag.toLowerCase() === 'en') return DEFAULT_LANG;
  return tag;
}

export type ListenMode = 'on-device' | 'cloud';

export type ListenErrorKind =
  | 'not-supported'
  | 'permission-denied'
  | 'no-microphone'
  | 'no-speech'
  | 'network'
  | 'language-not-supported'
  | 'other';

export interface ListenError {
  kind: ListenErrorKind;
  message: string;
  /** The recogniser's own error code (`language-not-supported`, `network`, ...), when it gave one. */
  code?: string;
}

/** How long stop() waits for the recogniser's last words before it settles with what it has. */
export const STOP_TIMEOUT_MS = 3000;

/** A microphone the caller opened for the hold: the track the recogniser listens on, a name for the screen, and how to let it go. */
export interface MicInput {
  label: string;
  track: MediaStreamTrack;
  /** The browser's id for the device, when known. */
  deviceId?: string;
  /** Called when the input heard nothing for a whole stretch of the hold, so the caller does not choose it again. */
  silent?(): void;
  close(): void;
}

export type ListenResult = { ok: true; text: string; mode: ListenMode } | { ok: false; text: string; error: ListenError };

export interface ListenSession {
  /** Where the recognition runs: 'cloud' means the browser sends the audio away. Changes if on-device failed and the hold went on in cloud mode. */
  readonly mode: ListenMode;
  /** Ends listening (release) and resolves once the recognizer has delivered its last words. Safe to call twice. */
  stop(): Promise<ListenResult>;
  /** Drops the recording; no result is delivered. */
  abort(): void;
}

export type ListenStart = { ok: true; session: ListenSession } | { ok: false; error: ListenError };

export interface ListenOptions {
  lang?: string;
  /** The text so far (settled parts and the part still being worked out), on every update. */
  onInterim?: (text: string) => void;
  /** The settled text, once, when listening ends cleanly. */
  onFinal?: (text: string) => void;
  /** The recogniser says the mic is open (its start or audiostart event); again after a fallback restart. */
  onStart?: () => void;
  /** On-device recognition failed (language pack or service missing) and the same hold restarted in cloud mode. */
  onFallback?: () => void;
  onError?: (error: ListenError) => void;
  /** Opens the input to listen on, or resolves nothing to use the phone's default microphone. Listening starts once it settles. */
  openInput?: () => Promise<MicInput | undefined>;
  /** Which input the hold ended up on: the chosen input's label, or nothing for the default microphone (also after a fallback). */
  onInput?: (label: string | undefined) => void;
}

// TypeScript's DOM lib has no SpeechRecognition types; these are the parts used here.
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
interface RecognitionEvent {
  readonly results: ArrayLike<RecognitionResult>;
}
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
type RecognizerConstructor = new () => Recognizer;

function recognizerConstructor(): RecognizerConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as { SpeechRecognition?: RecognizerConstructor; webkitSpeechRecognition?: RecognizerConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function isListenSupported(): boolean {
  return recognizerConstructor() !== undefined;
}

const GRANT_MIC =
  'To allow it, open the phone\'s Settings, then Apps, then Postern (or Chrome), then Permissions, then Microphone, and choose Allow.';

const ERROR_KINDS: Record<string, [ListenErrorKind, string]> = {
  'not-allowed': ['permission-denied', `The microphone is not allowed for Postern. ${GRANT_MIC}`],
  'service-not-allowed': [
    'permission-denied',
    `The phone's speech service is not allowed for Postern. Check that the Microphone permission is Allow, and that the phone's speech recognition is switched on. ${GRANT_MIC}`,
  ],
  'audio-capture': ['no-microphone', 'No microphone was found.'],
  'no-speech': ['no-speech', 'No speech was heard.'],
  network: ['network', "The phone's speech service failed: network (it needs a connection here and could not reach it)."],
  'language-not-supported': ['language-not-supported', "The phone's speech service failed: language-not-supported (this language is not available for speech recognition)."],
};

function errorFor(code: string): ListenError {
  const [kind, message] = ERROR_KINDS[code] ?? ['other', `The phone's speech service failed: ${code}.`];
  return { kind, message, code };
}

/** Errors that only mean this stretch of listening ended (a pause, a blip): the hold carries on. */
const TRANSIENT_ERRORS = new Set(['no-speech', 'network', 'aborted']);

/** How many times in a row a recogniser that ends at once (a failing loop, not a pause) is started again before the hold gives up. */
export const MAX_IDLE_RESTARTS = 5;

/**
 * A stretch of listening that lasted this long ended because of silence, a pause while he thinks, not
 * because something is failing: it does not count toward MAX_IDLE_RESTARTS. Android Chrome ends the
 * recogniser after a few seconds of quiet, so a long pause is many such stretches in a row.
 */
export const MIN_LIVE_STRETCH_MS = 1500;

/**
 * How long a recogniser that has ended at once MAX_IDLE_RESTARTS times in a row waits before it is started again, once he
 * has said words: his turn is never cut while he holds, and a recogniser that keeps ending (another sound on the phone
 * taking the microphone) is not started over and over at once.
 */
export const IDLE_RESTART_WAIT_MS = 500;

/**
 * How long a chosen input has to give a result after the recogniser starts on it. Earbuds whose microphone is
 * not routed give none and raise no error, and Android may not end the stretch for many seconds, so the hold
 * goes on on the default microphone once this has passed with nothing heard (mw-f7gmps.1).
 */
export const INPUT_SILENT_MS = 2500;

/** What an on-device attempt can fail with when the phone lacks the speech pack or service for it. */
const ON_DEVICE_FAILURES = new Set(['language-not-supported', 'service-not-allowed']);

/** True when `next` is `previous` grown by more words: the same phrase said further, not a new one. */
function extendsPhrase(previous: string, next: string): boolean {
  const before = previous.toLowerCase();
  const after = next.toLowerCase();
  return after.startsWith(before) && (after.length === before.length || after[before.length] === ' ');
}

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:]+$/, ''))
    .filter(Boolean);

/** How many words of `a` are in `b` in the same order. */
function wordsInOrder(a: readonly string[], b: readonly string[]): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const next = [0];
    for (let j = 0; j < b.length; j++) next.push(word === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]));
    row = next;
  }
  return row[b.length];
}

/** True when `next` is `previous` heard again with a word changed on the way (Kieran, Chiron): same opening, most words kept, no shorter. */
function revisesPhrase(previous: string, next: string): boolean {
  const before = wordsOf(previous);
  const after = wordsOf(next);
  let lead = 0;
  while (lead < before.length && before[lead] === after[lead]) lead++;
  return after.length >= before.length && lead >= 2 && wordsInOrder(before, after) >= 0.75 * before.length;
}

/** `next` taken as the phrase `previous` grown or corrected, or `previous` kept when `next` is only its start; undefined when `next` is a new phrase. */
function samePhrase(previous: string, next: string): string | undefined {
  if (extendsPhrase(previous, next) || revisesPhrase(previous, next)) return next;
  if (extendsPhrase(next, previous)) return previous;
  return undefined;
}

/**
 * The phrases so far, after `before` (those heard before the recogniser last restarted). Desktop
 * Chrome updates one result in place and adds a new one for each utterance, so the results are
 * joined in order. Android Chrome sends every hypothesis as a new result, each the whole phrase so
 * far: a result that grows the one before, or changes one of its words, replaces it, so the phrase
 * is said once; the same holds for the first phrase after a restart, which can be the last one
 * before it heard again.
 */
function phrases(before: readonly string[], results: ArrayLike<RecognitionResult>): string[] {
  const parts = [...before];
  for (let i = 0; i < results.length; i++) {
    const text = results[i][0]?.transcript.trim();
    if (!text) continue;
    const same = parts.length > 0 ? samePhrase(parts[parts.length - 1], text) : undefined;
    if (same !== undefined) parts[parts.length - 1] = same;
    else parts.push(text);
  }
  return parts;
}

/** Asks for on-device recognition; true only when the browser offers it and accepts it. */
function askOnDevice(recognizer: Recognizer): boolean {
  if (!('processLocally' in recognizer)) return false;
  try {
    recognizer.processLocally = true;
    return recognizer.processLocally === true;
  } catch {
    return false;
  }
}

function configure(Ctor: RecognizerConstructor, lang: string, onDevice: boolean): { recognizer: Recognizer; mode: ListenMode } {
  const recognizer = new Ctor();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = lang;
  if (onDevice) return { recognizer, mode: askOnDevice(recognizer) ? 'on-device' : 'cloud' };
  if ('processLocally' in recognizer) {
    try {
      recognizer.processLocally = false;
    } catch {
      // the browser's default is already cloud
    }
  }
  return { recognizer, mode: 'cloud' };
}

/** Begins listening now (call it on press); the session's stop() is the release. */
export function startListening(options: ListenOptions = {}): ListenStart {
  const Ctor = recognizerConstructor();
  if (!Ctor) {
    return { ok: false, error: { kind: 'not-supported', message: 'This browser cannot turn speech into text.' } };
  }

  let lang = recognizerLang(options.lang);
  let current: Recognizer;
  let mode: ListenMode;
  try {
    ({ recognizer: current, mode } = configure(Ctor, lang, true));
  } catch (err) {
    return { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' } };
  }

  let text = '';
  // The phrases heard so far, and those from the stretches of listening before the recogniser last restarted.
  let heard: string[] = [];
  let carried: string[] = [];
  // The last transient error: reported only if the hold ends with nothing heard.
  let transient = null as ListenError | null;
  let idleRestarts = 0;
  // When the recogniser was last started: how long it listened before it ended tells a pause from a failure.
  let stretchStart = Date.now();
  let error = null as ListenError | null;
  let outcome = null as ListenResult | null;
  let announced = false;
  let retried = false;
  let langRetried = false;
  let inputRetried = false;
  let stopping = false;
  let input: MicInput | undefined;
  // True once the chosen input produced any result: a quiet stretch after that is a pause, not a dead microphone.
  let inputHeard = false;
  let pending = options.openInput !== undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Runs out INPUT_SILENT_MS after the recogniser starts on a chosen input that has not been heard yet.
  let inputWatch: ReturnType<typeof setTimeout> | undefined;
  // A restart put off by IDLE_RESTART_WAIT_MS; released while it waits, the hold settles at once.
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let settle: (result: ListenResult) => void = () => {};
  const settled = new Promise<ListenResult>((resolve) => {
    settle = resolve;
  });

  const announce = () => {
    if (announced) return;
    announced = true;
    options.onStart?.();
  };
  const dropInput = () => {
    clearTimeout(inputWatch);
    const open = input;
    input = undefined;
    try {
      open?.close();
    } catch {
      // already closed
    }
  };
  /** Starts `recognizer` on the chosen input's track; a browser that refuses the track gets the default microphone instead. */
  const begin = (recognizer: Recognizer) => {
    stretchStart = Date.now();
    if (input) {
      try {
        recognizer.start(input.track);
        if (!inputHeard && inputWatch === undefined) inputWatch = setTimeout(leaveSilentInput, INPUT_SILENT_MS);
        return;
      } catch {
        dropInput();
        options.onInput?.(undefined);
      }
    }
    recognizer.start();
  };
  /** Marks the chosen input silent and lets it go, telling the caller the hold is on the default microphone now. */
  const giveUpInput = () => {
    try {
      input?.silent?.();
    } catch {
      // the mark is only a courtesy to later holds
    }
    dropInput();
    options.onInput?.(undefined);
  };
  /** The chosen input gave nothing in INPUT_SILENT_MS: a fresh recogniser goes on on the default microphone and the one on the input is stopped. */
  const leaveSilentInput = () => {
    if (outcome || stopping || !input || inputHeard) return;
    giveUpInput();
    const quiet = current;
    if (!restart(lang, mode === 'on-device', false)) return;
    try {
      quiet.abort();
    } catch {
      // already stopped
    }
  };
  const finish = () => {
    if (outcome) return;
    clearTimeout(timer);
    clearTimeout(waiting);
    waiting = undefined;
    dropInput();
    const failure = error ?? (text ? null : transient);
    outcome = failure ? { ok: false, text, error: failure } : { ok: true, text, mode };
    if (!failure) options.onFinal?.(text);
    settle(outcome);
  };

  /** Replaces the recogniser with a new one for `next` (same hold, in cloud mode unless `onDevice`; `fallback` tells the caller it fell back from on-device); false when it could not start, leaving the old one in place. */
  const restart = (next: string, onDevice: boolean, fallback: boolean): boolean => {
    const previous = { recognizer: current, mode, announced, lang };
    try {
      const fresh = configure(Ctor, next, onDevice);
      current = fresh.recognizer;
      mode = fresh.mode;
      announced = false;
      lang = next;
      attach(current);
      begin(current);
      if (fallback) options.onFallback?.();
      return true;
    } catch {
      current = previous.recognizer;
      mode = previous.mode;
      announced = previous.announced;
      lang = previous.lang;
      return false;
    }
  };

  /** Starts `recognizer` as the one this hold listens through; the one it replaces goes quiet. */
  const attach = (recognizer: Recognizer) => {
    const live = () => recognizer === current;
    recognizer.onstart = recognizer.onaudiostart = () => live() && announce();
    recognizer.onresult = (event) => {
      if (!live()) return;
      heard = phrases(carried, event.results);
      text = heard.join(' ');
      transient = null;
      idleRestarts = 0;
      if (input) {
        inputHeard = true;
        clearTimeout(inputWatch);
      }
      announce();
      options.onInterim?.(text);
    };
    recognizer.onerror = (event) => {
      if (!live() || outcome) return;
      if (!stopping && TRANSIENT_ERRORS.has(event.error)) {
        transient = errorFor(event.error);
        return;
      }
      if (mode === 'on-device' && !retried && !stopping && !outcome && !text && ON_DEVICE_FAILURES.has(event.error)) {
        retried = true;
        if (restart(lang, false, true)) return;
      }
      if (event.error === 'audio-capture' && input && !inputRetried && !stopping && !text) {
        // The chosen input has no capture device behind it: go on the phone's default microphone.
        inputRetried = true;
        dropInput();
        options.onInput?.(undefined);
        if (restart(lang, mode === 'on-device', false)) return;
      }
      if (event.error === 'language-not-supported' && !langRetried && !stopping && !text && lang !== DEFAULT_LANG) {
        langRetried = true;
        if (restart(DEFAULT_LANG, false, false)) return;
      }
      error = errorFor(event.error);
      options.onError?.(error);
    };
    recognizer.onend = () => {
      if (!live() || outcome) return;
      if (!stopping && !error) {
        // He is still holding: the recogniser ended by itself, so start it again and keep what was heard.
        // A stretch that listened for a while only met his silence: it is a pause, not a failure, so it does not count.
        if (Date.now() - stretchStart >= MIN_LIVE_STRETCH_MS) idleRestarts = 0;
        // The chosen input gave nothing in a whole stretch: go on the phone's default microphone, and not that input again.
        if (input && !inputHeard) giveUpInput();
        carried = heard;
        if (idleRestarts < MAX_IDLE_RESTARTS) {
          try {
            begin(recognizer);
            idleRestarts++;
            return;
          } catch {
            // cannot restart: settle with what was heard
          }
        } else if (text) {
          // He has said words and still holds: a recogniser that keeps ending at once never ends his turn.
          // It is given a moment and started again, for as long as he holds.
          waiting = setTimeout(() => {
            waiting = undefined;
            if (outcome || stopping || recognizer !== current) return;
            try {
              begin(recognizer);
            } catch {
              finish();
            }
          }, IDLE_RESTART_WAIT_MS);
          return;
        }
        if (!text) {
          error = transient ?? errorFor('no-speech');
          options.onError?.(error);
        }
      }
      finish();
    };
  };

  attach(current);
  if (options.openInput) {
    // The input opens first; the recogniser starts when it is ready (or has failed to open, and the default microphone is used).
    options
      .openInput()
      .catch(() => undefined)
      .then((opened) => {
        pending = false;
        if (outcome) {
          opened?.close();
          return;
        }
        input = opened;
        try {
          begin(current);
        } catch (err) {
          error = { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' };
          options.onError?.(error);
          finish();
          return;
        }
        if (input) options.onInput?.(input.label);
      });
  } else {
    try {
      current.start();
    } catch (err) {
      return { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' } };
    }
  }

  const session: ListenSession = {
    get mode() {
      return mode;
    },
    stop() {
      if (!outcome && !stopping && (pending || waiting !== undefined)) {
        // Released before the input opened (nothing was heard), or while the recogniser waits to start again (nothing more is coming).
        stopping = true;
        finish();
      } else if (!outcome && !stopping) {
        stopping = true;
        // A recogniser that never says it has ended must not hold the screen: settle with what was heard.
        timer = setTimeout(() => {
          finish();
          try {
            current.abort();
          } catch {
            // already stopped
          }
        }, STOP_TIMEOUT_MS);
        try {
          current.stop();
        } catch {
          current.onend?.();
        }
      }
      return settled;
    },
    abort() {
      clearTimeout(timer);
      clearTimeout(inputWatch);
      clearTimeout(waiting);
      dropInput();
      outcome = outcome ?? { ok: true, text: '', mode };
      settle(outcome);
      try {
        current.abort();
      } catch {
        // already stopped
      }
    },
  };
  return { ok: true, session };
}
