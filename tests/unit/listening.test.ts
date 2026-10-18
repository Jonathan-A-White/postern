// tests/unit/listening.test.ts — mw-gq6.570: while a hold listens the page says it cannot record, so voice-kit's listener starts
// the recogniser again on a pause instead of recording the rest; the recorder is back the moment the hold is over.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMic, type MicFake } from 'voice-kit/testing/mic';
import { listensThroughPauses } from '../../src/services/listening';
import { manualClock, type ManualClock } from '../support/honest-speech';

let mic: MicFake;
let clock: ManualClock;

beforeEach(() => {
  clock = manualClock();
  mic = installMic(window, { clock });
});
afterEach(() => mic.uninstall());

const recorderThere = () => typeof window.MediaRecorder !== 'undefined';

describe('listensThroughPauses', () => {
  it('hides MediaRecorder once the recogniser is open, and gives it back on stop', async () => {
    const started = listensThroughPauses.start({});
    if (!started.ok) throw new Error('did not start');
    expect(recorderThere()).toBe(true);
    clock.advance(mic.options.openMs);
    expect(recorderThere()).toBe(false);
    const stopped = started.session.stop();
    clock.advance(5000);
    await stopped;
    expect(recorderThere()).toBe(true);
    expect(window.MediaRecorder).toBe(mic.MediaRecorder);
  });

  it('gives it back on abort, and on an abort before the recogniser opened keeps it', () => {
    const early = listensThroughPauses.start({});
    if (!early.ok) throw new Error('did not start');
    early.session.abort();
    clock.advance(mic.options.openMs + 1000);
    expect(recorderThere()).toBe(true);

    const opened = listensThroughPauses.start({});
    if (!opened.ok) throw new Error('did not start');
    clock.advance(mic.options.openMs);
    expect(recorderThere()).toBe(false);
    opened.session.abort();
    expect(recorderThere()).toBe(true);
  });

  it('keeps it hidden until the last of two overlapping holds is over', () => {
    const first = listensThroughPauses.start({});
    const second = listensThroughPauses.start({});
    if (!first.ok || !second.ok) throw new Error('did not start');
    clock.advance(mic.options.openMs);
    first.session.abort();
    expect(recorderThere()).toBe(false);
    second.session.abort();
    expect(recorderThere()).toBe(true);
  });
});
