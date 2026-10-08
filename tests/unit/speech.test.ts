import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSpeaking, isSupported, speak, speechText, stop, subscribe } from '../../src/services/speech';

class FakeUtterance {
  text: string;
  voice: unknown = null;
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function installFakeSynthesis(voices: Array<{ lang: string }> = []) {
  const speakFn = vi.fn();
  const cancelFn = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak: speakFn, cancel: cancelFn, getVoices: () => voices });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return { speakFn, cancelFn };
}

/** A synthesis whose voice list is empty until `load` is called, which fires voiceschanged (as Android Chrome does). */
function installLateVoices() {
  const voices: Array<{ lang: string }> = [];
  const listeners = new Set<() => void>();
  const speakFn = vi.fn();
  const cancelFn = vi.fn();
  vi.stubGlobal('speechSynthesis', {
    speak: speakFn,
    cancel: cancelFn,
    getVoices: () => voices,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  const load = (list: Array<{ lang: string }>) => {
    voices.push(...list);
    for (const listener of [...listeners]) listener();
  };
  return { speakFn, cancelFn, load };
}

describe('speech', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported when the phone has no speechSynthesis', () => {
    expect(isSupported()).toBe(false);
  });

  it('reports supported once speechSynthesis is present', () => {
    installFakeSynthesis();
    expect(isSupported()).toBe(true);
  });

  it('cancels any current utterance before speaking the new one', () => {
    const { speakFn, cancelFn } = installFakeSynthesis();
    speak('read this aloud');
    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(speakFn).toHaveBeenCalledTimes(1);
    const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
    expect(utterance.text).toBe('read this aloud');
  });

  it('prefers a voice matching the device language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    const { speakFn } = installFakeSynthesis([{ lang: 'fr-FR' }, { lang: 'en-GB' }, { lang: 'en-US' }]);
    speak('hello');
    const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
    expect(utterance.voice).toEqual({ lang: 'en-GB' });
  });

  it('names en-US on every utterance when the phone language is a bare en (mw-44omaq.7)', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { speakFn } = installFakeSynthesis();
    speak('one');
    speak('two');
    expect(speakFn).toHaveBeenCalledTimes(2);
    for (const call of speakFn.mock.calls) expect((call[0] as FakeUtterance).lang).toBe('en-US');
  });

  it('names en-US when the phone names no language at all', () => {
    vi.stubGlobal('navigator', {});
    const { speakFn } = installFakeSynthesis();
    speak('hello');
    expect((speakFn.mock.calls[0][0] as FakeUtterance).lang).toBe('en-US');
  });

  it('keeps a full phone tag as the utterance language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    const { speakFn } = installFakeSynthesis();
    speak('hello');
    expect((speakFn.mock.calls[0][0] as FakeUtterance).lang).toBe('en-GB');
  });

  it('never gives an English utterance the Greek voice listed first', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { speakFn } = installFakeSynthesis([{ lang: 'el-GR' }, { lang: 'en-US' }]);
    speak('hello');
    expect((speakFn.mock.calls[0][0] as FakeUtterance).voice).toEqual({ lang: 'en-US' });
  });

  it('gives no voice, only the language, when no listed voice matches', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { speakFn } = installFakeSynthesis([{ lang: 'el-GR' }]);
    speak('hello');
    const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
    expect(utterance.voice).toBeNull();
    expect(utterance.lang).toBe('en-US');
  });

  it('matches a voice whose tag uses an underscore', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { speakFn } = installFakeSynthesis([{ lang: 'el_GR' }, { lang: 'en_US' }]);
    speak('hello');
    expect((speakFn.mock.calls[0][0] as FakeUtterance).voice).toEqual({ lang: 'en_US' });
  });

  describe('when the voice list is still empty', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits for voiceschanged, then gives the utterance the matching voice', () => {
      vi.stubGlobal('navigator', { language: 'en' });
      const { speakFn, load } = installLateVoices();
      speak('hello');
      expect(speakFn).not.toHaveBeenCalled();
      load([{ lang: 'el-GR' }, { lang: 'en-US' }]);
      expect(speakFn).toHaveBeenCalledTimes(1);
      const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
      expect(utterance.voice).toEqual({ lang: 'en-US' });
      expect(utterance.lang).toBe('en-US');
    });

    it('still speaks, with the language, when the voices never load', () => {
      vi.useFakeTimers();
      vi.stubGlobal('navigator', { language: 'en' });
      const { speakFn } = installLateVoices();
      speak('hello');
      expect(speakFn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(speakFn).toHaveBeenCalledTimes(1);
      const utterance = speakFn.mock.calls[0][0] as FakeUtterance;
      expect(utterance.voice).toBeNull();
      expect(utterance.lang).toBe('en-US');
    });

    it('speaks only once when the voices load after the cap passed', () => {
      vi.useFakeTimers();
      const { speakFn, load } = installLateVoices();
      speak('hello');
      vi.advanceTimersByTime(2000);
      load([{ lang: 'en-US' }]);
      expect(speakFn).toHaveBeenCalledTimes(1);
    });

    it('stop while waiting means the utterance is never spoken', () => {
      const { speakFn, load } = installLateVoices();
      speak('hello');
      stop();
      load([{ lang: 'en-US' }]);
      expect(speakFn).not.toHaveBeenCalled();
    });

    it('a second speak while waiting replaces the first', () => {
      const { speakFn, load } = installLateVoices();
      speak('first');
      speak('second');
      load([{ lang: 'en-US' }]);
      expect(speakFn).toHaveBeenCalledTimes(1);
      expect((speakFn.mock.calls[0][0] as FakeUtterance).text).toBe('second');
    });
  });

  it('stop cancels the current utterance', () => {
    const { cancelFn } = installFakeSynthesis();
    stop();
    expect(cancelFn).toHaveBeenCalledTimes(1);
  });
});

describe('speechText: what is spoken is not what is shown', () => {
  it('drops a bead id and keeps the rest of the line', () => {
    expect(speechText('1. mw-nqur1n.4 Prompts screen (you verified)')).toBe('1. Prompts screen (you verified)');
  });

  it('drops a list of ids without leaving a stray comma', () => {
    const spoken = speechText('Running now: mw-nqur1n.10, mw-j0f2d.30.');
    expect(spoken).not.toContain('mw-');
    expect(spoken).not.toMatch(/,\s*,/);
    expect(spoken).toBe('Running now.');
  });

  it('drops an id inside brackets and at the end of a sentence', () => {
    expect(speechText('Landed (mw-gq6.222) today')).toBe('Landed today');
    expect(speechText('Please look at mw-gq6.222.')).toBe('Please look at.');
  });

  it('drops a bare URL', () => {
    expect(speechText('see https://example.com/x')).toBe('see');
    expect(speechText('Open https://example.com/a?b=1, then reply.')).toBe('Open, then reply.');
  });

  it('keeps words that only look like an id', () => {
    expect(speechText('the xmw-abc flag and a mw- prefix stay')).toBe('the xmw-abc flag and a mw- prefix stay');
  });

  it('leaves a text with no id or URL unchanged, line breaks included', () => {
    const plain = 'Three things landed.\n\n  - one, two,  three';
    expect(speechText(plain)).toBe(plain);
  });

  it('speak() hands the shaped text to the synthesiser', () => {
    const { speakFn } = installFakeSynthesis();
    speak('Landed mw-nqur1n.4, mw-gq6.222.');
    expect((speakFn.mock.calls[0][0] as FakeUtterance).text).toBe('Landed.');
  });
});

describe('speechText with a lookup: a bead id is spoken as its title (mw-gq6.224)', () => {
  const titles = {
    'mw-gq6.222': '[bug] A decision card answered in words never goes dead on a real card: the words matcher needs the whole label',
    'mw-nqur1n.4': 'Prompts screen',
    'mw-long.1': 'one two three four five six seven eight nine ten eleven twelve',
    'mw-short.1': '[friction] Fix: it',
  };

  it('speaks the short title in place of the id', () => {
    expect(speechText('1. mw-gq6.222 landed', titles)).toBe('1. A decision card answered in words never goes dead on a real card landed');
    expect(speechText('see mw-nqur1n.4', titles)).toBe('see Prompts screen');
  });

  it('drops an id with no known title, leaving no stray comma', () => {
    expect(speechText('Running: mw-zzz.1, mw-nqur1n.4.', titles)).toBe('Running: Prompts screen.');
  });

  it('cuts a title with no colon to its first 8 words', () => {
    expect(speechText('see mw-long.1 now', titles)).toBe('see one two three four five six seven eight now');
  });

  it('falls to the first 8 words when the part before the colon is under two words', () => {
    expect(speechText('see mw-short.1', titles)).toBe('see Fix: it');
  });

  it('accepts a Map as the lookup', () => {
    expect(speechText('see mw-nqur1n.4', new Map(Object.entries(titles)))).toBe('see Prompts screen');
  });

  it('with no lookup the ids are dropped as before', () => {
    expect(speechText('1. mw-gq6.222 landed')).toBe('1. landed');
    expect(speechText('Running now: mw-nqur1n.10, mw-j0f2d.30.')).toBe('Running now.');
  });

  it('speak() hands the titled text to the synthesiser', () => {
    const { speakFn } = installFakeSynthesis();
    speak('Landed mw-nqur1n.4.', { titles });
    expect((speakFn.mock.calls[0][0] as FakeUtterance).text).toBe('Landed Prompts screen.');
  });
});

describe('speech tracks who is speaking, by a key', () => {
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  const lastUtterance = (speakFn: ReturnType<typeof vi.fn>) => speakFn.mock.calls.at(-1)![0] as FakeUtterance;

  it('says the key that started the speech is speaking, and no other', () => {
    installFakeSynthesis();
    speak('one', { key: 'a' });
    expect(isSpeaking('a')).toBe(true);
    expect(isSpeaking('b')).toBe(false);
  });

  it('a speak() with no key speaks and names nobody', () => {
    installFakeSynthesis();
    speak('one');
    expect(isSpeaking('a')).toBe(false);
  });

  it('clears when the utterance ends, and still calls onEnd', () => {
    const { speakFn } = installFakeSynthesis();
    const onEnd = vi.fn();
    speak('one', { key: 'a', onEnd });
    lastUtterance(speakFn).onend!();
    expect(isSpeaking('a')).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('clears when the utterance errors', () => {
    const { speakFn } = installFakeSynthesis();
    speak('one', { key: 'a' });
    lastUtterance(speakFn).onerror!();
    expect(isSpeaking('a')).toBe(false);
  });

  it('clears on stop(), which cancels', () => {
    const { cancelFn } = installFakeSynthesis();
    speak('one', { key: 'a' });
    cancelFn.mockClear();
    stop();
    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(isSpeaking('a')).toBe(false);
  });

  it('starting another key hands the speaking over, and the cancelled one ending late changes nothing', () => {
    const { speakFn } = installFakeSynthesis();
    speak('one', { key: 'a' });
    const first = lastUtterance(speakFn);
    speak('two', { key: 'b' });
    expect(isSpeaking('a')).toBe(false);
    expect(isSpeaking('b')).toBe(true);
    first.onerror!(); // a real synth reports the cancelled utterance after the new one began
    first.onend!();
    expect(isSpeaking('b')).toBe(true);
  });

  it('tells subscribers on every change and stops when they unsubscribe', () => {
    const { speakFn } = installFakeSynthesis();
    const listener = vi.fn();
    const off = subscribe(listener);
    speak('one', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
    lastUtterance(speakFn).onend!();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    speak('two', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
