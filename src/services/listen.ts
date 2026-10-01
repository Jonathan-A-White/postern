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
// hold goes on, the recogniser is started again and the earlier words are kept. The
// recogniser always gets a full language tag (en-US when none is given, a bare 'en'
// widened to it), and a language-not-supported error is retried once with en-US
// before it is shown, because the phone's service rejects tags it has no pack for.

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
  start(): void;
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

/** How many times in a row the recogniser is started again, with nothing heard in between, before the hold gives up. */
export const MAX_IDLE_RESTARTS = 5;

/** What an on-device attempt can fail with when the phone lacks the speech pack or service for it. */
const ON_DEVICE_FAILURES = new Set(['language-not-supported', 'service-not-allowed']);

/** True when `next` is `previous` grown by more words: the same phrase said further, not a new one. */
function extendsPhrase(previous: string, next: string): boolean {
  const before = previous.toLowerCase();
  const after = next.toLowerCase();
  return after.startsWith(before) && (after.length === before.length || after[before.length] === ' ');
}

/**
 * The words so far. Desktop Chrome updates one result in place and adds a new one for each
 * utterance, so the results are joined in order. Android Chrome sends every growing hypothesis
 * as a new result, each the whole phrase so far: a result that extends the one before replaces
 * it, so the phrase is said once.
 */
function transcript(results: ArrayLike<RecognitionResult>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const text = results[i][0]?.transcript.trim();
    if (!text) continue;
    if (parts.length > 0 && extendsPhrase(parts[parts.length - 1], text)) parts[parts.length - 1] = text;
    else parts.push(text);
  }
  return parts.join(' ');
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
  // The words from the stretches of listening before the recogniser last restarted.
  let carried = '';
  // The last transient error: reported only if the hold ends with nothing heard.
  let transient = null as ListenError | null;
  let idleRestarts = 0;
  let error = null as ListenError | null;
  let outcome = null as ListenResult | null;
  let announced = false;
  let retried = false;
  let langRetried = false;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (result: ListenResult) => void = () => {};
  const settled = new Promise<ListenResult>((resolve) => {
    settle = resolve;
  });

  const announce = () => {
    if (announced) return;
    announced = true;
    options.onStart?.();
  };
  const finish = () => {
    if (outcome) return;
    clearTimeout(timer);
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
      current.start();
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
      text = [carried, transcript(event.results)].filter(Boolean).join(' ');
      transient = null;
      idleRestarts = 0;
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
        if (idleRestarts < MAX_IDLE_RESTARTS) {
          try {
            carried = text;
            recognizer.start();
            idleRestarts++;
            return;
          } catch {
            // cannot restart: settle with what was heard
          }
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
  try {
    current.start();
  } catch (err) {
    return { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' } };
  }

  const session: ListenSession = {
    get mode() {
      return mode;
    },
    stop() {
      if (!outcome && !stopping) {
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
