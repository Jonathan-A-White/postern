// features/steps/talk-pause-bell.steps.tsx — runs features/talk-pause-bell.feature (mw-q6n8m0.16): the real Talk
// line and the real hold (voice-kit/composer) on voice-kit's honest microphone (voice-kit/testing/mic), whose
// recogniser, getUserMedia and MediaRecorder behave like Android Chrome's, on a clock the test moves. The recogniser
// ends by itself 1.5 s after the clip, as Android's does on a pause. Only the delivery of a turn is a double.
// (mw-gq6.570 replaced the scenario of mw-q6n8m0.16, which pinned the rest of a hold being recorded: that recording came back
// empty on Android, so the words after a pause were lost.)
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

  Scenario('mw-gq6.570 AC-1: a 3 second pause mid-sentence ends the recogniser; it is started again, and the words before and after the pause go as one turn', ({ Given, And, When, Then }) => {
    Given("the phone's microphone is voice-kit's honest one, hearing {string}", (_c, words: string) => {
      clock = manualClock();
      // the honest clip plays whatever words the test names: its audio is only the length of the clip
      mic = installMic(window, { clip: { ...clips.english, transcript: words }, clock });
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
    When('he pauses for {int} seconds and then says {string}', async (_c, seconds: number, words: string) => {
      expect(seconds * 1000).toBeGreaterThan(mic!.options.silenceMs);
      // what the microphone hears from here on is the second half
      mic!.options.clip = { ...clips.english, transcript: words };
      // the recogniser ends silenceMs after the first half; the second is heard by the one that listens on, within the pause and after it
      await advance(seconds * 1000 + mic!.options.openMs + mic!.clip.durationMs);
    });
    Then('the recogniser was started again, so the hold went on listening', () => {
      expect(starts!.mock.calls.length).toBeGreaterThan(1);
    });
    And('no recording of the rest of the hold was started', () => {
      expect(mic!.recorders).toHaveLength(0);
    });
    And('the page still has its recorder, because the kit listens through the pause by itself', () => {
      // voice-kit's throughPauses default does the work; the app no longer hides MediaRecorder (mw-06ggew.4)
      expect(window.MediaRecorder).toBe(mic!.MediaRecorder);
    });
    And('the live transcript reads {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    And('no turn has been sent', () => {
      expect(sendTurn).not.toHaveBeenCalled();
    });
    When('he lets go of the talk button', async () => {
      fireEvent.pointerUp(await talkButton('Release to send'));
      // the recogniser's last words arrive on the microphone's clock: move it on until the turn has gone
      await waitFor(async () => {
        await advance(100);
        expect(sendTurn).toHaveBeenCalledTimes(1);
      });
    });
    Then('one turn is sent with the words {string}', (_c, words: string) => {
      expect(sendTurn).toHaveBeenCalledTimes(1);
      const turn = sendTurn.mock.calls[0][0] as TalkTurn;
      expect(turn).toMatchObject({ role: 'turn', talk: { turn: 1 } });
      expect(turn.text).toBe(words);
    });
    And('the screen does not say that words after the pause could not be made out', () => {
      expect(screen.queryByText(/could not be made out/)).not.toBeInTheDocument();
    });
  });
});
