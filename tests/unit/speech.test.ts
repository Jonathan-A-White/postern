import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSupported, speak, speechText, stop } from '../../src/services/speech';

class FakeUtterance {
  text: string;
  voice: unknown = null;
  onend: (() => void) | null = null;
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
