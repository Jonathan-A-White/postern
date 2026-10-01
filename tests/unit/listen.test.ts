import { describe, it, expect, afterEach, vi } from 'vitest';
import { isListenSupported, startListening } from '../../src/services/listen';

interface FakeAlt {
  transcript: string;
}
interface FakeResult {
  isFinal: boolean;
  0: FakeAlt;
  length: 1;
}

function result(transcript: string, isFinal: boolean): FakeResult {
  return { isFinal, 0: { transcript }, length: 1 };
}

/** A recognizer the test drives by hand, the way a browser's would fire. */
class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally?: boolean = false;
  startFn = vi.fn();
  stopFn = vi.fn(() => this.onend?.());
  abortFn = vi.fn(() => this.onend?.());
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    this.startFn();
  }
  stop() {
    this.stopFn();
  }
  abort() {
    this.abortFn();
  }
  say(results: FakeResult[]) {
    this.onresult?.({ resultIndex: 0, results });
  }
}

/** A recognizer with no `processLocally` property, like a browser without on-device speech. */
class CloudOnlyRecognizer extends FakeRecognizer {
  constructor() {
    super();
    delete this.processLocally;
  }
}

/** One that has the property but throws when asked to use it (language pack missing). */
class RefusingRecognizer extends FakeRecognizer {
  constructor() {
    super();
    Object.defineProperty(this, 'processLocally', {
      get: () => false,
      set: (value: boolean) => {
        if (value) throw new Error('refused');
      },
    });
  }
}

function install(Ctor: unknown = FakeRecognizer, name = 'SpeechRecognition') {
  FakeRecognizer.instances = [];
  vi.stubGlobal(name, Ctor);
}

function started() {
  const result = startListening({ lang: 'en-GB' });
  if (!result.ok) throw new Error('expected listening to start');
  return result.session;
}

describe('listen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported, without throwing, when the browser has no SpeechRecognition', () => {
    expect(isListenSupported()).toBe(false);
    const started = startListening();
    expect(started).toEqual({ ok: false, error: { kind: 'not-supported', message: expect.any(String) } });
  });

  it('finds the webkit-prefixed recognizer too', () => {
    install(FakeRecognizer, 'webkitSpeechRecognition');
    expect(isListenSupported()).toBe(true);
    expect(startListening().ok).toBe(true);
  });

  it('starts the recognizer on hold, asking for interim results and the given language', () => {
    install();
    started();
    const recognizer = FakeRecognizer.instances[0];
    expect(recognizer.startFn).toHaveBeenCalledTimes(1);
    expect(recognizer.interimResults).toBe(true);
    expect(recognizer.continuous).toBe(true);
    expect(recognizer.lang).toBe('en-GB');
  });

  it('calls onInterim with the text so far, final and interim parts together', () => {
    install();
    const onInterim = vi.fn();
    const begin = startListening({ onInterim });
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('hello', false)]);
    recognizer.say([result('hello there', true), result('how are', false)]);
    expect(onInterim.mock.calls.map((call) => call[0])).toEqual(['hello', 'hello there how are']);
  });

  it('gives the final text on stop, and calls onFinal with it', async () => {
    install();
    const onFinal = vi.fn();
    const begin = startListening({ onFinal });
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('hello there', true), result('how are', false)]);
    const outcome = await begin.session.stop();
    expect(recognizer.stopFn).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true, text: 'hello there how are', mode: 'on-device' });
    expect(onFinal).toHaveBeenCalledWith('hello there how are');
  });

  it('gives an empty text when nothing was said', async () => {
    install();
    const outcome = await started().stop();
    expect(outcome).toEqual({ ok: true, text: '', mode: 'on-device' });
  });

  it('reports a denied microphone as a value, not a throw', async () => {
    install();
    const onError = vi.fn();
    const begin = startListening({ onError });
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.onerror?.({ error: 'not-allowed' });
    recognizer.onend?.();
    const outcome = await begin.session.stop();
    expect(outcome).toEqual({ ok: false, text: '', error: { kind: 'permission-denied', message: expect.any(String) } });
    expect(onError).toHaveBeenCalledWith({ kind: 'permission-denied', message: expect.any(String) });
  });

  it('treats service-not-allowed as permission denied too', async () => {
    install();
    const begin = startListening();
    if (!begin.ok) throw new Error('expected listening to start');
    FakeRecognizer.instances[0].onerror?.({ error: 'service-not-allowed' });
    const outcome = await begin.session.stop();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('permission-denied');
  });

  it('names the other errors the recognizer can raise', async () => {
    install();
    const kinds: Record<string, string> = {
      'no-speech': 'no-speech',
      'audio-capture': 'no-microphone',
      network: 'network',
      'language-not-supported': 'language-not-supported',
      aborted: 'other',
    };
    for (const [raised, kind] of Object.entries(kinds)) {
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      FakeRecognizer.instances.at(-1)?.onerror?.({ error: raised });
      const outcome = await begin.session.stop();
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.kind).toBe(kind);
    }
  });

  it('keeps the words heard before an error', async () => {
    install();
    const begin = startListening();
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('half a sentence', false)]);
    recognizer.onerror?.({ error: 'network' });
    const outcome = await begin.session.stop();
    expect(outcome.text).toBe('half a sentence');
  });

  it('returns start errors as values when the recognizer refuses to start', () => {
    install(
      class extends FakeRecognizer {
        start() {
          throw new Error('already started');
        }
      },
    );
    const begin = startListening();
    expect(begin).toEqual({ ok: false, error: { kind: 'other', message: expect.any(String) } });
  });

  it('asks for on-device recognition where offered, and reports on-device', async () => {
    install();
    const session = started();
    expect(FakeRecognizer.instances[0].processLocally).toBe(true);
    expect(session.mode).toBe('on-device');
    const outcome = await session.stop();
    if (outcome.ok) expect(outcome.mode).toBe('on-device');
  });

  it('reports cloud when the browser offers no on-device recognition', async () => {
    install(CloudOnlyRecognizer);
    const session = started();
    expect(session.mode).toBe('cloud');
    expect(await session.stop()).toEqual({ ok: true, text: '', mode: 'cloud' });
  });

  it('falls back to the browser default when on-device is refused, and reports cloud', async () => {
    install(RefusingRecognizer);
    const session = started();
    expect(session.mode).toBe('cloud');
    await session.stop();
  });

  it('abort drops the recording without a result', () => {
    install();
    started().abort();
    expect(FakeRecognizer.instances[0].abortFn).toHaveBeenCalledTimes(1);
  });

  it('stop is safe to call twice', async () => {
    install();
    const session = started();
    const first = await session.stop();
    const second = await session.stop();
    expect(second).toEqual(first);
    expect(FakeRecognizer.instances[0].stopFn).toHaveBeenCalledTimes(1);
  });
});
