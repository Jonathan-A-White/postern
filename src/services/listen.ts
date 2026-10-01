// src/services/listen.ts — the dictation twin of speech.ts: wraps the browser's
// SpeechRecognition (webkit-prefixed on Safari and older Chrome). Start it when the
// person presses and holds, stop it on release. It asks for on-device recognition
// where the browser offers it and says which mode it ended up in, because in cloud
// mode the browser sends the audio to its vendor's speech service. Support is
// detected without throwing, and every failure comes back as a value.

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
}

export type ListenResult = { ok: true; text: string; mode: ListenMode } | { ok: false; text: string; error: ListenError };

export interface ListenSession {
  /** Where the recognition runs: 'cloud' means the browser sends the audio away. */
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

const ERROR_KINDS: Record<string, [ListenErrorKind, string]> = {
  'not-allowed': ['permission-denied', 'The microphone is blocked for this app. Allow it in the browser settings to dictate.'],
  'service-not-allowed': ['permission-denied', 'Speech recognition is blocked for this app. Allow it in the browser settings to dictate.'],
  'audio-capture': ['no-microphone', 'No microphone was found.'],
  'no-speech': ['no-speech', 'No speech was heard.'],
  network: ['network', 'Speech recognition needs a connection here and could not reach it.'],
  'language-not-supported': ['language-not-supported', 'This language is not available for speech recognition.'],
};

function errorFor(code: string): ListenError {
  const [kind, message] = ERROR_KINDS[code] ?? ['other', `Listening stopped (${code}).`];
  return { kind, message };
}

function transcript(results: ArrayLike<RecognitionResult>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const text = results[i][0]?.transcript.trim();
    if (text) parts.push(text);
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

/** Begins listening now (call it on press); the session's stop() is the release. */
export function startListening(options: ListenOptions = {}): ListenStart {
  const Ctor = recognizerConstructor();
  if (!Ctor) {
    return { ok: false, error: { kind: 'not-supported', message: 'This browser cannot turn speech into text.' } };
  }

  let recognizer: Recognizer;
  let mode: ListenMode;
  try {
    recognizer = new Ctor();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    if (options.lang) recognizer.lang = options.lang;
    mode = askOnDevice(recognizer) ? 'on-device' : 'cloud';
  } catch (err) {
    return { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' } };
  }

  let text = '';
  let error = null as ListenError | null;
  let outcome = null as ListenResult | null;
  let settle: (result: ListenResult) => void = () => {};
  const settled = new Promise<ListenResult>((resolve) => {
    settle = resolve;
  });

  recognizer.onresult = (event) => {
    text = transcript(event.results);
    options.onInterim?.(text);
  };
  recognizer.onerror = (event) => {
    error = errorFor(event.error);
    options.onError?.(error);
  };
  recognizer.onend = () => {
    if (outcome) return;
    outcome = error ? { ok: false, text, error } : { ok: true, text, mode };
    if (!error) options.onFinal?.(text);
    settle(outcome);
  };

  try {
    recognizer.start();
  } catch (err) {
    return { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : 'Listening could not start.' } };
  }

  let stopping = false;
  const session: ListenSession = {
    mode,
    stop() {
      if (!outcome && !stopping) {
        stopping = true;
        try {
          recognizer.stop();
        } catch {
          recognizer.onend?.();
        }
      }
      return settled;
    },
    abort() {
      outcome = outcome ?? { ok: true, text: '', mode };
      settle(outcome);
      try {
        recognizer.abort();
      } catch {
        // already stopped
      }
    },
  };
  return { ok: true, session };
}
