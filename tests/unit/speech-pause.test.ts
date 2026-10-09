// mw-q6n8m0.9: anything read aloud can be paused, resumed, restarted and stopped. The service
// speaks sentence by sentence, keeps the sentence reached, and resumes by speaking on from it
// (speechSynthesis.pause/resume are not honoured on Android Chrome). The synthesiser here is
// bsv-kit's honest one (mw-it6qk5.4): it queues utterances, reports each one's start and end in time,
// and reports a cancelled one as an error, as Chrome does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHonestSpeech, type HonestSpeech } from '../support/honest-speech';
import { getSpeech, isSpeaking, pause, restart, resume, speak, stop } from '../../src/services/speech';

let synth: HonestSpeech;

beforeEach(() => {
  synth = installHonestSpeech();
});

afterEach(() => {
  stop();
  synth.uninstall();
});

const THREE = 'First thing. Second thing. Third thing.';

describe('speech: pause, resume, restart, stop (mw-q6n8m0.9)', () => {
  it('speaks a long text a sentence at a time and reports the sentence reached', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    expect(synth.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
    expect(getSpeech()).toMatchObject({ status: 'playing', key: 'a', index: 0, count: 3 });
    synth.finish();
    expect(getSpeech().index).toBe(1);
  });

  it('pause keeps the sentence index and does not report the speech as ended', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth.advance(0);
    synth.finish();
    const nativePause = vi.spyOn(synth.synth, 'pause');
    pause();
    expect(getSpeech()).toMatchObject({ status: 'paused', key: 'a', index: 1, count: 3 });
    expect(synth.waiting()).toEqual([]);
    expect(nativePause).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(isSpeaking('a')).toBe(true);
  });

  it('resume speaks on from the sentence it was paused in', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    synth.finish();
    pause();
    resume();
    expect(getSpeech().status).toBe('playing');
    expect(synth.waiting()).toEqual(['Second thing.', 'Third thing.']);
  });

  it('a speech that is paused and resumed still ends once, at its last sentence', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth.advance(0);
    pause();
    resume();
    synth.advance(0);
    synth.finish();
    synth.finish();
    expect(onEnd).not.toHaveBeenCalled();
    synth.finish();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(getSpeech().status).toBe('idle');
  });

  it('restart speaks again from the first sentence, from playing or from paused', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    synth.finish();
    restart();
    expect(getSpeech()).toMatchObject({ status: 'playing', index: 0 });
    expect(synth.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
    synth.advance(0);
    synth.finish();
    pause();
    restart();
    expect(synth.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
  });

  it('stop clears the speech: nothing is kept to resume', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    pause();
    stop();
    expect(getSpeech()).toMatchObject({ status: 'idle', key: null });
    expect(isSpeaking('a')).toBe(false);
    resume();
    expect(synth.waiting()).toEqual([]);
  });

  it('the cancelled sentence reporting its error late does not end or move the speech', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth.advance(0);
    pause();
    expect(onEnd).not.toHaveBeenCalled();
    expect(getSpeech()).toMatchObject({ status: 'paused', index: 0 });
  });

  it('a new speak replaces a paused one', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    pause();
    speak('Another one.', { key: 'b' });
    expect(getSpeech()).toMatchObject({ status: 'playing', key: 'b', count: 1 });
    expect(synth.waiting()).toEqual(['Another one.']);
  });

  it('speak with resumeIfPaused continues the paused speech of the same key and text, handing it the new end callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    speak(THREE, { key: 'a', onEnd: first });
    synth.advance(0);
    synth.finish();
    pause();
    speak(THREE, { key: 'a', onEnd: second, resumeIfPaused: true });
    expect(synth.waiting()).toEqual(['Second thing.', 'Third thing.']);
    synth.advance(0);
    synth.finish();
    synth.finish();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('speak with resumeIfPaused starts from the top when nothing is paused', () => {
    speak(THREE, { key: 'a', resumeIfPaused: true });
    expect(synth.waiting()).toHaveLength(3);
  });

  it('the page going hidden pauses what is speaking, and showing again does not resume it', () => {
    speak(THREE, { key: 'a' });
    synth.advance(0);
    synth.finish();
    let state: DocumentVisibilityState = 'hidden';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getSpeech()).toMatchObject({ status: 'paused', index: 1 });
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getSpeech().status).toBe('paused');
    spy.mockRestore();
  });

  it('a one-sentence text is one utterance', () => {
    speak('hello', { key: 'a' });
    expect(synth.waiting()).toEqual(['hello']);
    expect(getSpeech().count).toBe(1);
  });

  it('a decimal point or an abbreviation without a following space does not split a sentence', () => {
    speak('It cost 3.5 dollars. Fine.', { key: 'a' });
    expect(synth.waiting()).toEqual(['It cost 3.5 dollars.', 'Fine.']);
  });
});
