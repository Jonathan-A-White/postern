import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSupported, speak, stop } from '../../src/services/speech';

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
