import { describe, it, expect, afterEach, vi } from 'vitest';
import { isListenSupported, startListening, STOP_TIMEOUT_MS } from '../../src/services/listen';

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
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
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
    expect(outcome).toEqual({ ok: false, text: '', error: { kind: 'permission-denied', code: 'not-allowed', message: expect.any(String) } });
    expect(onError).toHaveBeenCalledWith({ kind: 'permission-denied', code: 'not-allowed', message: expect.any(String) });
  });

  it('treats service-not-allowed as permission denied too (in network mode, where there is nothing to fall back to)', async () => {
    install(CloudOnlyRecognizer);
    const begin = startListening();
    if (!begin.ok) throw new Error('expected listening to start');
    FakeRecognizer.instances[0].onerror?.({ error: 'service-not-allowed' });
    const outcome = await begin.session.stop();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('permission-denied');
  });

  it('names the other errors the recognizer can raise', async () => {
    install(CloudOnlyRecognizer);
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

  it('says the mic is open only when the recogniser says so (start or audiostart)', () => {
    install();
    const onStart = vi.fn();
    startListening({ onStart });
    expect(onStart).not.toHaveBeenCalled();
    const recognizer = FakeRecognizer.instances[0];
    recognizer.onaudiostart?.();
    recognizer.onstart?.();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('counts the first words as the mic being open too', () => {
    install();
    const onStart = vi.fn();
    startListening({ onStart });
    FakeRecognizer.instances[0].say([result('hello', false)]);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('hands an error during the hold to onError at once, naming what the recogniser said', () => {
    install(CloudOnlyRecognizer);
    const onError = vi.fn();
    startListening({ onError });
    FakeRecognizer.instances[0].onerror?.({ error: 'bad-grammar' });
    expect(onError).toHaveBeenCalledWith({ kind: 'other', code: 'bad-grammar', message: "The phone's speech service failed: bad-grammar." });
  });

  it('says how to grant the microphone when it is not allowed', () => {
    install(CloudOnlyRecognizer);
    const onError = vi.fn();
    startListening({ onError });
    FakeRecognizer.instances[0].onerror?.({ error: 'not-allowed' });
    const { message } = onError.mock.calls[0][0];
    expect(message).toContain('not allowed');
    expect(message).toContain('Settings');
    expect(message).toContain('Microphone');
  });

  describe('when stop() never hears the recogniser end', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function silentStop() {
      install(
        class extends FakeRecognizer {
          constructor() {
            super();
            this.stopFn = vi.fn();
          }
        },
      );
    }

    it(`settles after ${STOP_TIMEOUT_MS} ms with no words`, async () => {
      vi.useFakeTimers();
      silentStop();
      const onFinal = vi.fn();
      const begin = startListening({ onFinal });
      if (!begin.ok) throw new Error('expected listening to start');
      let outcome: unknown;
      void begin.session.stop().then((value) => (outcome = value));
      await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS - 1);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toEqual({ ok: true, text: '', mode: 'on-device' });
      expect(FakeRecognizer.instances[0].abortFn).toHaveBeenCalledTimes(1);
    });

    it('settles with the words heard so far', async () => {
      vi.useFakeTimers();
      silentStop();
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      FakeRecognizer.instances[0].say([result('already said', false)]);
      const outcome = begin.session.stop();
      await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
      expect(await outcome).toEqual({ ok: true, text: 'already said', mode: 'on-device' });
    });

    it('does not wait the full time when the recogniser does end', async () => {
      vi.useFakeTimers();
      install();
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      expect(await begin.session.stop()).toEqual({ ok: true, text: '', mode: 'on-device' });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('when on-device recognition fails', () => {
    it.each(['language-not-supported', 'service-not-allowed'])('retries the same hold once in network mode after %s', async (code) => {
      install();
      const onFallback = vi.fn();
      const onError = vi.fn();
      const onStart = vi.fn();
      const begin = startListening({ lang: 'en-GB', onFallback, onError, onStart });
      if (!begin.ok) throw new Error('expected listening to start');
      expect(begin.session.mode).toBe('on-device');
      FakeRecognizer.instances[0].onerror?.({ error: code });
      expect(FakeRecognizer.instances).toHaveLength(2);
      const retry = FakeRecognizer.instances[1];
      expect(retry.startFn).toHaveBeenCalledTimes(1);
      expect(retry.processLocally).toBe(false);
      expect(retry.lang).toBe('en-GB');
      expect(begin.session.mode).toBe('cloud');
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      // the first recogniser ending, late, does not end the hold
      FakeRecognizer.instances[0].onend?.();
      retry.onaudiostart?.();
      expect(onStart).toHaveBeenCalledTimes(1);
      retry.say([result('it works', false)]);
      expect(await begin.session.stop()).toEqual({ ok: true, text: 'it works', mode: 'cloud' });
    });

    it('retries only once: a second failure is reported', async () => {
      install();
      const onError = vi.fn();
      const begin = startListening({ onError });
      if (!begin.ok) throw new Error('expected listening to start');
      FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
      FakeRecognizer.instances[1].onerror?.({ error: 'language-not-supported' });
      expect(FakeRecognizer.instances).toHaveLength(2);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'language-not-supported' }));
    });

    it('does not retry other errors, or a mode that was already network', () => {
      install();
      const onError = vi.fn();
      startListening({ onError });
      FakeRecognizer.instances[0].onerror?.({ error: 'network' });
      expect(FakeRecognizer.instances).toHaveLength(1);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('reports the first error when the network-mode recogniser cannot start either', () => {
      let made = 0;
      install(
        class extends FakeRecognizer {
          start() {
            if (made++ > 0) throw new Error('already started');
            super.start();
          }
        },
      );
      const onError = vi.fn();
      const onFallback = vi.fn();
      const begin = startListening({ onError, onFallback });
      if (!begin.ok) throw new Error('expected listening to start');
      FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
      expect(onFallback).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'language-not-supported' }));
    });
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
