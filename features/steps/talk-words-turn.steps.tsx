// features/steps/talk-words-turn.steps.tsx — runs features/talk-words-turn.feature (mw-deiheir.3): the real Talk line screen and
// hook on voice-kit's honest microphone and speech synthesiser, a turn driven through the words group (begin, heard, send) and
// then through a hold of the same words. Only the delivery of a turn is a double.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { installMic, clips, type MicFake } from 'voice-kit/testing/mic';
import { forgetSilentInputs } from 'voice-kit/composer';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import type { TalkWords } from '../../src/cockpit/useTalkLine';
import { db, type MessageRow } from '../../src/data/db';
import { lock, setKey } from '../../src/services/keySession';
import { getSpeech, stop as stopSpeaking } from '../../src/services/speech';
import { encodeTurn } from '../../src/services/talk';
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
const wordsRef: { current: TalkWords | undefined } = { current: undefined };

/** Moves the microphone's clock on, and lets what that set going settle. */
const advance = async (ms: number) => {
  await act(async () => {
    clock.advance(ms);
    await Promise.resolve();
  });
};

afterAll(() => {
  cleanup();
  lock();
  mic?.uninstall();
  speech?.uninstall();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-words-turn.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    stopSpeaking();
    vi.unstubAllGlobals();
    mic?.uninstall();
    mic = null;
    wordsRef.current = undefined;
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

  Scenario('mw-deiheir.3 AC-1: a turn begun, heard and sent from words is the turn a hold of the same words sends', ({ Given, And, When, Then }) => {
    Given('the Talk line is open on the phone\'s honest microphone, which hears {string}', async (_c, words: string) => {
      clock = manualClock();
      mic = installMic(window, { clip: { ...clips.english, transcript: words }, clock });
      render(<TalkLineScreen wordsRef={wordsRef} />);
      await screen.findByRole('button', { name: 'Hold to talk' });
      await waitFor(() => expect(wordsRef.current).toBeDefined());
    });
    When('a turn is begun from words', () => {
      act(() => {
        expect(wordsRef.current!.begin()).toEqual({ taken: true });
      });
    });
    And('the words {string} are heard', (_c, words: string) => {
      act(() => wordsRef.current!.heard(words));
    });
    Then('the live transcript reads {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
    });
    And('no microphone has been opened', () => {
      expect(mic!.recognitions).toHaveLength(0);
      expect(mic!.requests).toHaveLength(0);
    });
    When('the words {string} are sent', (_c, words: string) => {
      act(() => wordsRef.current!.send(words));
    });
    Then('one turn is sent with the words {string}', async (_c, words: string) => {
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
      expect(sendTurn.mock.calls[0][0]).toMatchObject({ role: 'turn', text: words, talk: { turn: 1 } });
    });
    And('the status reads {string}', async (_c, status: string) => {
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(status));
    });
    When('the Mayor answers {string}', async (_c, text: string) => {
      const first = sendTurn.mock.calls[0][0] as TalkTurn;
      const txid = `direct:${'1'.padStart(64, '0')}`;
      const row: MessageRow = {
        id: `${txid}:0`,
        txid,
        vout: 0,
        seq: 1,
        class: 'talk',
        to: 'to',
        from: 'from',
        ts: Math.floor(Date.now() / 1000),
        ciphertext: '',
        plaintext: encodeTurn({ talk: first.talk, text, role: 'answer' }),
        direction: 'received',
        read: false,
        heard: false,
      };
      await db.messages.put(row);
    });
    Then('the answer is spoken', async () => {
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The Mayor is speaking…'));
      await act(async () => speech!.advance(0));
      await waitFor(() => expect(getSpeech().status).toBe('playing'));
      expect(speech!.waiting().join(' ')).toContain('Three things are in flight.');
    });
    When('the answer has been spoken to its end', async () => {
      for (let i = 0; i < 3; i += 1) await act(async () => speech!.finishAll());
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Hold the button and speak.'));
    });
    And('he holds the talk button until the microphone has heard {string}, and lets go', async (_c, words: string) => {
      expect(mic!.options.clip.transcript).toBe(words);
      fireEvent.pointerDown(await screen.findByRole('button', { name: 'Hold to talk' }));
      await waitFor(() => expect(mic!.recognitions.length).toBeGreaterThan(0));
      await advance(mic!.options.openMs + mic!.clip.durationMs);
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
      fireEvent.pointerUp(await screen.findByRole('button', { name: 'Release to send' }));
      await waitFor(async () => {
        await advance(100);
        expect(sendTurn).toHaveBeenCalledTimes(2);
      });
    });
    Then('a second turn is sent', () => {
      expect(sendTurn.mock.calls[1][0]).toMatchObject({ role: 'turn', talk: { turn: 2 } });
    });
    And('the two turns are the same record, apart from their number', () => {
      const [first, second] = [sendTurn.mock.calls[0][0] as TalkTurn, sendTurn.mock.calls[1][0] as TalkTurn];
      expect({ ...second, talk: { ...second.talk, turn: first.talk.turn } }).toEqual(first);
    });
  });
});
