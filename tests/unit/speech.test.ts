import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSpeaking, isSupported, speak, speechText, stop, subscribe } from '../../src/services/speech';
import { installHonestSpeech, voiceOf, type HonestSpeech } from '../support/honest-speech';

// The synthesiser is bsv-kit's honest one (mw-it6qk5.4): it queues, starts an utterance after speak(), fires
// start/boundary/end in time and reports a cancelled one as an error. `installSynthesis` puts it on the window.
let speech: HonestSpeech | null = null;

function installSynthesis(langs?: string[]): HonestSpeech {
  speech = installHonestSpeech(langs ? { voices: langs.map(voiceOf) } : {});
  return speech;
}

/** A synthesis whose voice list is empty until `load` is called, which fires voiceschanged (as Android Chrome does). */
function installLateVoices(langs: string[] = ['en-US']) {
  speech = installHonestSpeech({ voices: langs.map(voiceOf), voicesLate: true });
  return { speech, load: () => speech!.advance(speech!.options.voicesDelayMs) };
}

afterEach(() => {
  speech?.uninstall();
  speech = null;
  vi.unstubAllGlobals();
});

describe('speech', () => {
  it('reports unsupported when the phone has no speechSynthesis', () => {
    expect(isSupported()).toBe(false);
  });

  it('reports supported once speechSynthesis is present', () => {
    installSynthesis();
    expect(isSupported()).toBe(true);
  });

  it('cancels any current utterance before speaking the new one', () => {
    const { synth, log } = installSynthesis();
    const cancel = vi.spyOn(synth, 'cancel');
    speak('read this aloud');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe('read this aloud');
  });

  it('prefers a voice matching the device language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    const { log } = installSynthesis(['fr-FR', 'en-GB', 'en-US']);
    speak('hello');
    expect(log[0].voice).toBe('en-GB');
  });

  it('names en-US on every utterance when the phone language is a bare en (mw-44omaq.7)', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { log } = installSynthesis();
    speak('one');
    speak('two');
    expect(log).toHaveLength(2);
    for (const entry of log) expect(entry.lang).toBe('en-US');
  });

  it('names en-US when the phone names no language at all', () => {
    vi.stubGlobal('navigator', {});
    const { log } = installSynthesis();
    speak('hello');
    expect(log[0].lang).toBe('en-US');
  });

  it('keeps a full phone tag as the utterance language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    const { log } = installSynthesis();
    speak('hello');
    expect(log[0].lang).toBe('en-GB');
  });

  it('never gives an English utterance the Greek voice listed first', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { log } = installSynthesis(['el-GR', 'en-US']);
    speak('hello');
    expect(log[0].voice).toBe('en-US');
  });

  it('gives no voice, only the language, when no listed voice matches', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    const { log } = installSynthesis(['el-GR']);
    speak('hello');
    expect(log[0].voice).toBeNull();
    expect(log[0].lang).toBe('en-US');
  });

  it('matches a voice whose tag uses an underscore', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { log } = installSynthesis(['el_GR', 'en_US']);
    speak('hello');
    expect(log[0].voice).toBe('en_US');
  });

  describe('when the voice list is still empty', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('waits for voiceschanged, then gives the utterance the matching voice', () => {
      vi.stubGlobal('navigator', { language: 'en' });
      const { speech: late, load } = installLateVoices(['el-GR', 'en-US']);
      speak('hello');
      expect(late.log).toHaveLength(0);
      load();
      expect(late.log).toHaveLength(1);
      expect(late.log[0].voice).toBe('en-US');
      expect(late.log[0].lang).toBe('en-US');
    });

    it('still speaks, with the language, when the voices never load', () => {
      vi.useFakeTimers();
      vi.stubGlobal('navigator', { language: 'en' });
      const { speech: late } = installLateVoices();
      speak('hello');
      expect(late.log).toHaveLength(0);
      vi.advanceTimersByTime(2000);
      expect(late.log).toHaveLength(1);
      expect(late.log[0].voice).toBeNull();
      expect(late.log[0].lang).toBe('en-US');
    });

    it('speaks only once when the voices load after the cap passed', () => {
      vi.useFakeTimers();
      const { speech: late, load } = installLateVoices();
      speak('hello');
      vi.advanceTimersByTime(2000);
      load();
      expect(late.log).toHaveLength(1);
    });

    it('stop while waiting means the utterance is never spoken', () => {
      const { speech: late, load } = installLateVoices();
      speak('hello');
      stop();
      load();
      expect(late.log).toHaveLength(0);
    });

    it('a second speak while waiting replaces the first', () => {
      const { speech: late, load } = installLateVoices();
      speak('first');
      speak('second');
      load();
      expect(late.log).toHaveLength(1);
      expect(late.log[0].text).toBe('second');
    });
  });

  it('stop cancels the current utterance', () => {
    const { synth } = installSynthesis();
    const cancel = vi.spyOn(synth, 'cancel');
    stop();
    expect(cancel).toHaveBeenCalledTimes(1);
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
    const { log } = installSynthesis();
    speak('Landed mw-nqur1n.4, mw-gq6.222.');
    expect(log[0].text).toBe('Landed.');
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
    const { log } = installSynthesis();
    speak('Landed mw-nqur1n.4.', { titles });
    expect(log[0].text).toBe('Landed Prompts screen.');
  });
});

describe('speech tracks who is speaking, by a key', () => {
  afterEach(() => {
    stop();
  });

  it('says the key that started the speech is speaking, and no other', () => {
    installSynthesis();
    speak('one', { key: 'a' });
    expect(isSpeaking('a')).toBe(true);
    expect(isSpeaking('b')).toBe(false);
  });

  it('a speak() with no key speaks and names nobody', () => {
    installSynthesis();
    speak('one');
    expect(isSpeaking('a')).toBe(false);
  });

  it('clears when the utterance ends, and still calls onEnd', () => {
    const { finish } = installSynthesis();
    const onEnd = vi.fn();
    speak('one', { key: 'a', onEnd });
    expect(isSpeaking('a')).toBe(true);
    finish();
    expect(isSpeaking('a')).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('clears when the utterance errors', () => {
    const { advance, synth } = installSynthesis();
    speak('one', { key: 'a' });
    advance(0); // the engine has begun it
    synth.cancel(); // another app takes the speech: the utterance errors 'interrupted'
    expect(isSpeaking('a')).toBe(false);
  });

  it('clears on stop(), which cancels', () => {
    const { synth } = installSynthesis();
    speak('one', { key: 'a' });
    const cancel = vi.spyOn(synth, 'cancel');
    stop();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(isSpeaking('a')).toBe(false);
  });

  it('starting another key hands the speaking over, and the cancelled one ending late changes nothing', () => {
    const { advance, finish, log } = installSynthesis();
    speak('one', { key: 'a' });
    advance(0);
    speak('two', { key: 'b' }); // the honest synth reports the cancelled sentence as an error as the new one begins
    expect(log[0].outcome).toBe('interrupted');
    expect(isSpeaking('a')).toBe(false);
    expect(isSpeaking('b')).toBe(true);
    finish();
    expect(isSpeaking('b')).toBe(false);
  });

  it('tells subscribers on every change and stops when they unsubscribe', () => {
    const { finish } = installSynthesis();
    const listener = vi.fn();
    const off = subscribe(listener);
    speak('one', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
    finish();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    speak('two', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
