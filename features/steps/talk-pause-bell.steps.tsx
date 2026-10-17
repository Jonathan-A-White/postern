// features/steps/talk-pause-bell.steps.tsx — runs features/talk-pause-bell.feature (mw-q6n8m0.16): the real Talk
// line and the real hold (voice-kit/composer) on voice-kit's honest microphone (voice-kit/testing/mic), whose
// recogniser, getUserMedia and MediaRecorder behave like Android Chrome's, on a clock the test moves. The recogniser
// ends by itself 1.5 s after the clip, as Android's does on a pause. Only the delivery of a turn is a double.
// jsdom has no AudioContext, so the rest of the hold cannot be played back into a recogniser here: the words after
// the pause are the phone's to check (the story's HOW TO CHECK IT); this pins the bell, the recording and the turn.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi, type MockInstance } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { installMic, clips, type FakeTrack, type MicFake } from 'voice-kit/testing/mic';
import { forgetSilentInputs } from 'voice-kit/composer';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { db } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { stop as stopSpeaking } from '../../src/services/speech';
import { installHonestSpeech, manualClock, type HonestSpeech, type ManualClock } from '../../tests/support/honest-speech';
import type { TalkTurn } from '../../src/model/talkLine';

const sendTurn = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendTurn: (...args: unknown[]) => sendTurn(...args),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

class FakeAudio {
  loop = false;
  constructor(public src: string) {}
  play() {
    return Promise.resolve();
  }
  pause() {}
}

let mic: MicFake | null = null;
let clock: ManualClock = manualClock();
let speech: HonestSpeech | null = null;
let starts: MockInstance<(track?: FakeTrack) => void> | null = null;

/** Moves the microphone's clock on, and lets what that set going (the page's promises and React) settle. */
const advance = async (ms: number) => {
  await act(async () => {
    clock.advance(ms);
    await Promise.resolve();
  });
};

afterAll(() => {
  cleanup();
  lock();
  starts?.mockRestore();
  mic?.uninstall();
  speech?.uninstall();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const talkButton = (name: string) => screen.findByRole('button', { name });

const feature = await loadFeature('features/talk-pause-bell.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    stopSpeaking();
    vi.unstubAllGlobals();
    starts?.mockRestore();
    mic?.uninstall();
    mic = null;
    sendTurn.mockReset();
    sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    setKey(new Uint8Array(32).fill(7));
    forgetSilentInputs();
    speech?.uninstall();
    speech = installHonestSpeech();
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    window.history.replaceState(null, '', '/?v=line');
  });

  Scenario('mw-q6n8m0.16 AC-1: a pause that ends the recogniser mid-hold does not start it again; the rest of the hold is recorded, and the words before the pause go as the turn', ({ Given, And, When, Then }) => {
    Given("the phone's microphone is voice-kit's honest one, hearing {string}", (_c, words: string) => {
      clock = manualClock();
      mic = installMic(window, { clip: clips.english, clock });
      expect(mic.clip.transcript).toBe(words);
      // every start() of a recogniser is the start tone on Android
      starts = vi.spyOn(mic.SpeechRecognition.prototype, 'start');
    });
    And('the Talk line is open', async () => {
      render(<TalkLineScreen />);
      await talkButton('Hold to talk');
    });
    When('he presses and holds the talk button until the recogniser has heard the whole clip', async () => {
      fireEvent.pointerDown(await talkButton('Hold to talk'));
      await waitFor(() => expect(starts).toHaveBeenCalledTimes(1));
      await advance(mic!.options.openMs + mic!.clip.durationMs);
    });
    Then('the live transcript reads {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
    });
    When('he pauses for {int} seconds and the recogniser ends by itself', async (_c, seconds: number) => {
      expect(seconds * 1000).toBeGreaterThan(mic!.options.silenceMs);
      // the recogniser ends silenceMs after the clip; the recording's getUserMedia answers grantMs later, inside the pause
      await advance(seconds * 1000);
    });
    Then('the recogniser has been started once in the hold, so no start tone rang mid-hold', () => {
      expect(starts).toHaveBeenCalledTimes(1);
      expect(mic!.recognitions).toHaveLength(1);
    });
    And('the rest of the hold is being recorded from the microphone', async () => {
      await waitFor(() => expect(mic!.recorders).toHaveLength(1));
      expect(mic!.recorders[0].state).toBe('recording');
      expect(mic!.recorders[0].stream.active).toBe(true);
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    When('he speaks on for {int} seconds and lets go of the talk button', async (_c, seconds: number) => {
      await advance(seconds * 1000);
      fireEvent.pointerUp(await talkButton('Release to send'));
      // the recorder stops on the microphone's clock: move it on until the turn has gone
      await waitFor(async () => {
        await advance(0);
        expect(sendTurn).toHaveBeenCalledTimes(1);
      });
    });
    Then('one turn is sent, starting with {string}', (_c, words: string) => {
      expect(sendTurn).toHaveBeenCalledTimes(1);
      const turn = sendTurn.mock.calls[0][0] as TalkTurn;
      expect(turn).toMatchObject({ role: 'turn', talk: { turn: 1 } });
      expect(turn.text.startsWith(words)).toBe(true);
    });
    And('the recording of the rest has stopped', () => {
      expect(mic!.recorders[0].state).toBe('inactive');
      expect(mic!.recorders[0].stream.active).toBe(false);
    });
    And('the recogniser was still started only once', () => {
      expect(starts).toHaveBeenCalledTimes(1);
    });
  });
});
