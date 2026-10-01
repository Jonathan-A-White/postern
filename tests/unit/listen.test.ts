import { describe, it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_LANG, isListenSupported, recognizerLang, startListening, IDLE_RESTART_WAIT_MS, MAX_IDLE_RESTARTS, STOP_TIMEOUT_MS, type ListenOptions } from '../../src/services/listen';

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
  startFn = vi.fn<(track?: unknown) => void>();
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
  start(track?: unknown) {
    this.startFn(track);
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

  it('joins separate final results in order, the way desktop Chrome delivers them', async () => {
    install();
    const onInterim = vi.fn();
    const begin = startListening({ onInterim });
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('hello there', true)]);
    recognizer.say([result('hello there', true), result('how are you', true)]);
    recognizer.say([result('hello there', true), result('how are you', true), result('today', false)]);
    expect(onInterim.mock.calls.map((call) => call[0])).toEqual(['hello there', 'hello there how are you', 'hello there how are you today']);
    const outcome = await begin.session.stop();
    expect(outcome).toEqual({ ok: true, text: 'hello there how are you today', mode: 'on-device' });
  });

  it('says the phrase once when each growing hypothesis arrives as a new result, as on Android Chrome', async () => {
    install();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const begin = startListening({ onInterim, onFinal });
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    const words = ['great', 'great I', 'great I see', 'great I see the', 'great I see the mic', 'great I see the mic button', 'great I see the mic button now'];
    const results: FakeResult[] = [];
    for (const [i, hypothesis] of words.entries()) {
      results.push(result(hypothesis, i === words.length - 1));
      recognizer.say([...results]);
    }
    expect(onInterim.mock.calls.map((call) => call[0])).toEqual(words);
    const outcome = await begin.session.stop();
    expect(outcome).toEqual({ ok: true, text: 'great I see the mic button now', mode: 'on-device' });
    expect(onFinal).toHaveBeenCalledWith('great I see the mic button now');
  });

  it('keeps a later utterance after the cumulative ones, and does not merge a word that merely starts the same', async () => {
    install();
    const begin = startListening();
    if (!begin.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('I', false), result('I see', false), result('I see it', true), result('it is', false), result('it is fine', false)]);
    recognizer.say([result('I', false), result('I see', false), result('I see it', true), result('it is', false), result('it is fine', false), result('item', false)]);
    const outcome = await begin.session.stop();
    expect(outcome).toEqual({ ok: true, text: 'I see it it is fine item', mode: 'on-device' });
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
      FakeRecognizer.instances[0].onerror?.({ error: 'audio-capture' });
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

  describe('while the hold is live and the recogniser ends or blips by itself (mw-j0f2d.19)', () => {
    it.each(['no-speech', 'network', 'aborted'])('does not treat a %s error as the end of the hold', (code) => {
      install();
      const onError = vi.fn();
      startListening({ onError });
      FakeRecognizer.instances[0].onerror?.({ error: code });
      expect(onError).not.toHaveBeenCalled();
    });

    it('starts the recogniser again when it ends by itself, and keeps the earlier text', async () => {
      install();
      const onFinal = vi.fn();
      const begin = startListening({ onFinal });
      if (!begin.ok) throw new Error('expected listening to start');
      const recognizer = FakeRecognizer.instances[0];
      recognizer.say([result('first part', true)]);
      recognizer.onend?.();
      expect(recognizer.startFn).toHaveBeenCalledTimes(2);
      expect(onFinal).not.toHaveBeenCalled();
      recognizer.say([result('second part', false)]);
      const outcome = await begin.session.stop();
      expect(outcome).toEqual({ ok: true, text: 'first part second part', mode: 'on-device' });
      expect(onFinal).toHaveBeenCalledTimes(1);
      expect(onFinal).toHaveBeenCalledWith('first part second part');
    });

    it('shows the earlier and later text together while listening, each said once', () => {
      install();
      const onInterim = vi.fn();
      startListening({ onInterim });
      const recognizer = FakeRecognizer.instances[0];
      recognizer.say([result('one', false), result('one two', false)]);
      recognizer.onend?.();
      recognizer.say([result('three', false), result('three four', false)]);
      expect(onInterim).toHaveBeenLastCalledWith('one two three four');
    });

    it('carries on after a no-speech error ends the recogniser, and hears later speech', async () => {
      install();
      const onError = vi.fn();
      const begin = startListening({ onError });
      if (!begin.ok) throw new Error('expected listening to start');
      const recognizer = FakeRecognizer.instances[0];
      recognizer.onerror?.({ error: 'no-speech' });
      recognizer.onend?.();
      expect(recognizer.startFn).toHaveBeenCalledTimes(2);
      recognizer.say([result('hello', false)]);
      expect(await begin.session.stop()).toEqual({ ok: true, text: 'hello', mode: 'on-device' });
      expect(onError).not.toHaveBeenCalled();
    });

    it('still ends with the transient error when stop() comes and nothing was heard', async () => {
      install();
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      FakeRecognizer.instances[0].onerror?.({ error: 'no-speech' });
      const outcome = await begin.session.stop();
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.kind).toBe('no-speech');
    });

    it('does not restart after stop()', async () => {
      install();
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      await begin.session.stop();
      expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledTimes(1);
    });

    it('does not restart after a real error, which still ends the hold with its message', async () => {
      for (const [code, kind] of [['not-allowed', 'permission-denied'], ['audio-capture', 'no-microphone']]) {
        install();
        const onError = vi.fn();
        const begin = startListening({ onError });
        if (!begin.ok) throw new Error('expected listening to start');
        const recognizer = FakeRecognizer.instances[0];
        recognizer.onerror?.({ error: code });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind, code, message: expect.any(String) }));
        recognizer.onend?.();
        expect(recognizer.startFn).toHaveBeenCalledTimes(1);
        const outcome = await begin.session.stop();
        expect(outcome.ok).toBe(false);
      }
    });

    it(`gives up after ${MAX_IDLE_RESTARTS} restarts in a row with nothing heard, and says why`, () => {
      install();
      const onError = vi.fn();
      startListening({ onError });
      const recognizer = FakeRecognizer.instances[0];
      for (let i = 0; i < MAX_IDLE_RESTARTS; i++) {
        recognizer.onerror?.({ error: 'network' });
        recognizer.onend?.();
      }
      expect(onError).not.toHaveBeenCalled();
      recognizer.onerror?.({ error: 'network' });
      recognizer.onend?.();
      expect(recognizer.startFn).toHaveBeenCalledTimes(MAX_IDLE_RESTARTS + 1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'network' }));
    });

    describe('a long pause while he thinks (mw-j0f2d.27)', () => {
      afterEach(() => vi.useRealTimers());

      it('keeps listening through many silent stretches, each ending by itself, and joins both halves into one turn', async () => {
        vi.useFakeTimers();
        install();
        const onError = vi.fn();
        const onFinal = vi.fn();
        const begin = startListening({ onError, onFinal });
        if (!begin.ok) throw new Error('expected listening to start');
        const recognizer = FakeRecognizer.instances[0];
        recognizer.say([result('twenty Mississippi', true)]);
        // The phone ends the recogniser on every few seconds of silence; a minute of it is far more than MAX_IDLE_RESTARTS stretches.
        for (let i = 0; i < MAX_IDLE_RESTARTS * 4; i++) {
          vi.advanceTimersByTime(5000);
          recognizer.onerror?.({ error: 'no-speech' });
          recognizer.onend?.();
        }
        expect(onError).not.toHaveBeenCalled();
        expect(recognizer.startFn).toHaveBeenCalledTimes(MAX_IDLE_RESTARTS * 4 + 1);
        recognizer.say([result('and the rest', false)]);
        const outcome = await begin.session.stop();
        expect(outcome).toEqual({ ok: true, text: 'twenty Mississippi and the rest', mode: 'on-device' });
        expect(onFinal).toHaveBeenCalledTimes(1);
        expect(onFinal).toHaveBeenCalledWith('twenty Mississippi and the rest');
      });

      it('still gives up when the recogniser ends again at once, over and over, after silent stretches', () => {
        vi.useFakeTimers();
        install();
        const onError = vi.fn();
        startListening({ onError });
        const recognizer = FakeRecognizer.instances[0];
        vi.advanceTimersByTime(5000);
        recognizer.onend?.();
        for (let i = 0; i <= MAX_IDLE_RESTARTS; i++) {
          recognizer.onerror?.({ error: 'network' });
          recognizer.onend?.();
        }
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'network' }));
      });
    });

    it('settles with what was heard when the recogniser cannot be started again', async () => {
      install();
      const begin = startListening();
      if (!begin.ok) throw new Error('expected listening to start');
      const recognizer = FakeRecognizer.instances[0];
      recognizer.say([result('some words', false)]);
      recognizer.startFn.mockImplementation(() => {
        throw new Error('busy');
      });
      recognizer.onend?.();
      expect(await begin.session.stop()).toEqual({ ok: true, text: 'some words', mode: 'on-device' });
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

describe('the recogniser language (mw-j0f2d.24)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a full tag: en-US when none is given, a bare en widened, any other tag kept', () => {
    expect(recognizerLang(undefined)).toBe('en-US');
    expect(recognizerLang('')).toBe('en-US');
    expect(recognizerLang('en')).toBe('en-US');
    expect(recognizerLang('en_GB')).toBe('en-GB');
    expect(recognizerLang('fr-CA')).toBe('fr-CA');
    expect(DEFAULT_LANG).toBe('en-US');
  });

  it('starts the recogniser in en-US when no language is given, and in a bare en widened to en-US', () => {
    install();
    startListening();
    startListening({ lang: 'en' });
    expect(FakeRecognizer.instances.map((r) => r.lang)).toEqual(['en-US', 'en-US']);
  });

  it('retries once with en-US on language-not-supported before the message is shown', async () => {
    install(CloudOnlyRecognizer);
    const onError = vi.fn();
    const onFallback = vi.fn();
    const begin = startListening({ lang: 'fr-FR', onError, onFallback });
    if (!begin.ok) throw new Error('expected listening to start');
    FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(FakeRecognizer.instances[1].lang).toBe('en-US');
    expect(FakeRecognizer.instances[1].startFn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    FakeRecognizer.instances[1].onerror?.({ error: 'language-not-supported' });
    expect(FakeRecognizer.instances).toHaveLength(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'language-not-supported' }));
  });

  it('works through the retry: words heard by the en-US recogniser are the result', async () => {
    install(CloudOnlyRecognizer);
    const begin = startListening({ lang: 'fr-FR' });
    if (!begin.ok) throw new Error('expected listening to start');
    FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
    FakeRecognizer.instances[1].say([result('hello there', false)]);
    expect(await begin.session.stop()).toEqual({ ok: true, text: 'hello there', mode: 'cloud' });
  });

  it('does not retry with en-US when the recogniser already asked for it', () => {
    install(CloudOnlyRecognizer);
    const onError = vi.fn();
    startListening({ onError });
    FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('tries en-US after the on-device attempt also fails, keeping the order: cloud first, then en-US', () => {
    install();
    const onError = vi.fn();
    startListening({ lang: 'fr-FR', onError });
    const seen = () => FakeRecognizer.instances.map((r) => [r.lang, r.processLocally]);
    FakeRecognizer.instances[0].onerror?.({ error: 'language-not-supported' });
    FakeRecognizer.instances[1].onerror?.({ error: 'language-not-supported' });
    expect(seen()).toEqual([['fr-FR', true], ['fr-FR', false], ['en-US', false]]);
    expect(onError).not.toHaveBeenCalled();
    FakeRecognizer.instances[2].onerror?.({ error: 'language-not-supported' });
    expect(onError).toHaveBeenCalledTimes(1);
  });
  describe('on a chosen input (his car\'s Bluetooth microphone)', () => {
    const car = () => {
      const close = vi.fn();
      const silent = vi.fn();
      return { label: 'Bluetooth headset', track: { kind: 'audio' } as unknown as MediaStreamTrack, close, silent };
    };
    const hold = (openInput: ListenOptions['openInput'], extra: ListenOptions = {}) => {
      const begun = startListening({ openInput, ...extra });
      if (!begun.ok) throw new Error('expected listening to start');
      return begun.session;
    };

    it('starts the recogniser on the input\'s track once it is open, and says which input', async () => {
      install();
      const input = car();
      const onInput = vi.fn();
      hold(() => Promise.resolve(input), { onInput });
      expect(FakeRecognizer.instances[0].startFn).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
      expect(onInput).toHaveBeenCalledWith('Bluetooth headset');
    });

    it('starts on the default microphone when no input is chosen', async () => {
      install();
      const onInput = vi.fn();
      hold(() => Promise.resolve(undefined), { onInput });
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledTimes(1));
      expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(undefined);
      expect(onInput).not.toHaveBeenCalled();
    });

    it('starts on the default microphone when opening the input fails', async () => {
      install();
      hold(() => Promise.reject(new Error('NotAllowedError')));
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(undefined));
    });

    it('goes on the default microphone when the browser refuses the track', async () => {
      install();
      const input = car();
      const onInput = vi.fn();
      hold(() => Promise.resolve(input), { onInput });
      FakeRecognizer.instances[0].startFn.mockImplementationOnce(() => {
        throw new Error('not a track');
      });
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledTimes(2));
      expect(FakeRecognizer.instances[0].startFn).toHaveBeenLastCalledWith(undefined);
      expect(onInput).toHaveBeenCalledWith(undefined);
      expect(input.close).toHaveBeenCalled();
    });

    it('starts again on the default microphone when the car input has no capture device', async () => {
      install();
      const input = car();
      const onError = vi.fn();
      const onInput = vi.fn();
      hold(() => Promise.resolve(input), { onError, onInput });
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
      FakeRecognizer.instances[0].onerror?.({ error: 'audio-capture' });
      expect(onError).not.toHaveBeenCalled();
      expect(FakeRecognizer.instances[1].startFn).toHaveBeenCalledWith(undefined);
      expect(onInput).toHaveBeenLastCalledWith(undefined);
      expect(input.close).toHaveBeenCalled();
    });

    it('keeps the track when the recogniser restarts itself during the hold, and lets it go on release', async () => {
      install();
      const input = car();
      const session = hold(() => Promise.resolve(input));
      await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
      // The input has given words (an input that gave none is left for the default microphone, mw-j0f2d.34).
      FakeRecognizer.instances[0].say([result('hel', false)]);
      FakeRecognizer.instances[0].onend?.();
      expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledTimes(2);
      expect(FakeRecognizer.instances[0].startFn).toHaveBeenLastCalledWith(input.track);
      FakeRecognizer.instances[0].say([result('hello', false)]);
      await session.stop();
      expect(input.close).toHaveBeenCalled();
    });

    it('settles with nothing heard and lets the input go when released before it opened', async () => {
      install();
      const input = car();
      let open: (value: typeof input) => void = () => {};
      const session = hold(() => new Promise((resolve) => (open = resolve)));
      const outcome = await session.stop();
      expect(outcome).toEqual({ ok: true, text: '', mode: 'on-device' });
      open(input);
      await vi.waitFor(() => expect(input.close).toHaveBeenCalled());
      expect(FakeRecognizer.instances[0].startFn).not.toHaveBeenCalled();
    });

    describe('an input that hears nothing (his AeroFit 2 earbuds, mw-j0f2d.34)', () => {
      it('goes on the default microphone when the stretch ends with no speech and no result, and returns the words heard there', async () => {
        install();
        const input = car();
        const onInput = vi.fn();
        const onError = vi.fn();
        const session = hold(() => Promise.resolve(input), { onInput, onError });
        await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
        const recognizer = FakeRecognizer.instances[0];
        recognizer.onerror?.({ error: 'no-speech' });
        recognizer.onend?.();
        expect(recognizer.startFn).toHaveBeenCalledTimes(2);
        expect(recognizer.startFn).toHaveBeenLastCalledWith(undefined);
        expect(onInput).toHaveBeenLastCalledWith(undefined);
        expect(input.silent).toHaveBeenCalledTimes(1);
        expect(input.close).toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        recognizer.say([result('hello there', false)]);
        expect(await session.stop()).toEqual({ ok: true, text: 'hello there', mode: 'on-device' });
      });

      it('goes on the default microphone when the stretch ends with no error at all and nothing heard', async () => {
        install();
        const input = car();
        hold(() => Promise.resolve(input));
        await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
        FakeRecognizer.instances[0].onend?.();
        expect(FakeRecognizer.instances[0].startFn).toHaveBeenLastCalledWith(undefined);
        expect(input.silent).toHaveBeenCalledTimes(1);
      });

      it('keeps the track on the restart when the input produced a result before a pause', async () => {
        install();
        const input = car();
        const onInput = vi.fn();
        hold(() => Promise.resolve(input), { onInput });
        await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
        const recognizer = FakeRecognizer.instances[0];
        recognizer.say([result('first part', false)]);
        recognizer.onerror?.({ error: 'no-speech' });
        recognizer.onend?.();
        expect(recognizer.startFn).toHaveBeenLastCalledWith(input.track);
        recognizer.onend?.();
        expect(recognizer.startFn).toHaveBeenLastCalledWith(input.track);
        expect(onInput).toHaveBeenCalledTimes(1);
        expect(input.silent).not.toHaveBeenCalled();
        expect(input.close).not.toHaveBeenCalled();
      });

      it('does not give up the input when the hold is released while the stretch ends', async () => {
        install();
        const input = car();
        const session = hold(() => Promise.resolve(input));
        await vi.waitFor(() => expect(FakeRecognizer.instances[0].startFn).toHaveBeenCalledWith(input.track));
        await session.stop();
        expect(input.silent).not.toHaveBeenCalled();
      });
    });
  });
});

describe('a pause while he holds, after his first words (mw-j0f2d.37)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const buds = () => ({ label: 'Bluetooth headset', track: { kind: 'audio' } as unknown as MediaStreamTrack, close: vi.fn(), silent: vi.fn() });

  /** The recogniser ends at once with no result, `times` over, as Android's does through a pause; each restart is let run. */
  async function endsAtOnce(recognizer: FakeRecognizer, times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      if (i % 2 === 0) recognizer.onerror?.({ error: 'no-speech' });
      recognizer.onend?.();
      await vi.advanceTimersByTimeAsync(IDLE_RESTART_WAIT_MS);
    }
  }

  it('keeps one turn, both halves in order, when the recogniser ends at once with no result over and over, and keeps the chosen input', async () => {
    vi.useFakeTimers();
    install();
    const input = buds();
    const onError = vi.fn();
    const onInput = vi.fn();
    const onFinal = vi.fn();
    const begun = startListening({ openInput: () => Promise.resolve(input), onError, onInput, onFinal });
    if (!begun.ok) throw new Error('expected listening to start');
    await vi.advanceTimersByTimeAsync(0);
    const recognizer = FakeRecognizer.instances[0];
    expect(recognizer.startFn).toHaveBeenCalledWith(input.track);
    recognizer.say([result("I'd love to see", true)]);
    const ends = MAX_IDLE_RESTARTS * 3;
    await endsAtOnce(recognizer, ends);
    expect(onError).not.toHaveBeenCalled();
    expect(recognizer.startFn).toHaveBeenCalledTimes(ends + 1);
    expect(recognizer.startFn.mock.calls.every(([track]) => track === input.track)).toBe(true);
    expect(input.silent).not.toHaveBeenCalled();
    expect(input.close).not.toHaveBeenCalled();
    expect(onInput).toHaveBeenCalledTimes(1);
    recognizer.say([result('Kieran where you can take pictures', false)]);
    const outcome = await begun.session.stop();
    expect(outcome).toEqual({ ok: true, text: "I'd love to see Kieran where you can take pictures", mode: 'on-device' });
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(input.close).toHaveBeenCalled();
  });

  it(`starts the recogniser again after ${MAX_IDLE_RESTARTS} quick ends only after a short wait, not at once`, async () => {
    vi.useFakeTimers();
    install();
    startListening();
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('first words', false)]);
    for (let i = 0; i <= MAX_IDLE_RESTARTS; i++) recognizer.onend?.();
    expect(recognizer.startFn).toHaveBeenCalledTimes(MAX_IDLE_RESTARTS + 1);
    await vi.advanceTimersByTimeAsync(IDLE_RESTART_WAIT_MS);
    expect(recognizer.startFn).toHaveBeenCalledTimes(MAX_IDLE_RESTARTS + 2);
  });

  it('settles at once with his words when he lets go while the recogniser waits to start again, and does not start it after', async () => {
    vi.useFakeTimers();
    install();
    const begun = startListening();
    if (!begun.ok) throw new Error('expected listening to start');
    const recognizer = FakeRecognizer.instances[0];
    recognizer.say([result('first words', false)]);
    for (let i = 0; i <= MAX_IDLE_RESTARTS; i++) recognizer.onend?.();
    let outcome: unknown;
    void begun.session.stop().then((settled) => (outcome = settled));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ ok: true, text: 'first words', mode: 'on-device' });
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    expect(recognizer.startFn).toHaveBeenCalledTimes(MAX_IDLE_RESTARTS + 1);
  });

  it('still gives up and says why when nothing at all was heard', async () => {
    vi.useFakeTimers();
    install();
    const onError = vi.fn();
    startListening({ onError });
    const recognizer = FakeRecognizer.instances[0];
    for (let i = 0; i <= MAX_IDLE_RESTARTS; i++) recognizer.onend?.();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'no-speech' }));
  });
});

describe('a restart never repeats words already heard (mw-j0f2d.37)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const listening = (options: ListenOptions = {}) => {
    install();
    const begun = startListening(options);
    if (!begun.ok) throw new Error('expected listening to start');
    return { session: begun.session, recognizer: FakeRecognizer.instances[0] };
  };

  it('holds each word once when a stretch ends on interim words and the restarted recogniser hears that phrase again, grown', async () => {
    const onInterim = vi.fn();
    const { session, recognizer } = listening({ onInterim });
    recognizer.say([result("I'd love to see Kieran", false)]);
    recognizer.onend?.();
    expect(recognizer.startFn).toHaveBeenCalledTimes(2);
    recognizer.say([result("I'd love to see Kieran where you can take pictures", false)]);
    expect(onInterim).toHaveBeenLastCalledWith("I'd love to see Kieran where you can take pictures");
    recognizer.say([result("I'd love to see Kieran where you can take pictures", true), result('and it tells you', false)]);
    expect(await session.stop()).toEqual({ ok: true, text: "I'd love to see Kieran where you can take pictures and it tells you", mode: 'on-device' });
  });

  it('holds each word once when the restarted recogniser hears the interim phrase with a word heard differently', async () => {
    const { session, recognizer } = listening();
    recognizer.say([result("I'd love to see Kieran", false)]);
    recognizer.onend?.();
    recognizer.say([result("I'd love to see Chiron where you can take pictures", false)]);
    expect(await session.stop()).toEqual({ ok: true, text: "I'd love to see Chiron where you can take pictures", mode: 'on-device' });
  });

  it('keeps the longer phrase when the restarted recogniser hands back only the start of it', async () => {
    const { session, recognizer } = listening();
    recognizer.say([result("I'd love to see Kieran where you", false)]);
    recognizer.onend?.();
    recognizer.say([result("I'd love to see Kieran", false)]);
    expect(await session.stop()).toEqual({ ok: true, text: "I'd love to see Kieran where you", mode: 'on-device' });
  });

  it("says his turn 11 once: Android's growing hypotheses that change a word on the way (Kieran, Chiron, Kieran)", async () => {
    const { session, recognizer } = listening();
    const hypotheses = [
      "I'd",
      "I'd love",
      "I'd love to see",
      "I'd love to see Kieran",
      "I'd love to see Chiron where you can take pictures",
      "I'd love to see Chiron where you can take pictures and it tells you what's",
      "I'd love to see Kieran where you can take pictures and it tells you what's in it",
      "I'd love to see Kieran where you can take pictures and it tells you what's in it puts it",
    ];
    const results: FakeResult[] = [];
    for (const [i, hypothesis] of hypotheses.entries()) {
      results.push(result(hypothesis, i === hypotheses.length - 1));
      recognizer.say([...results]);
    }
    expect(await session.stop()).toEqual({ ok: true, text: hypotheses.at(-1), mode: 'on-device' });
  });

  it('still joins two utterances that start alike, the way desktop Chrome delivers them', async () => {
    const { session, recognizer } = listening();
    recognizer.say([result('I think so', true), result("I think that's right", true)]);
    expect(await session.stop()).toEqual({ ok: true, text: "I think so I think that's right", mode: 'on-device' });
  });
});
