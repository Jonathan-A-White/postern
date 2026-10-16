// features/steps/ideas-only-talk.steps.tsx — runs features/ideas-only-talk.feature (mw-8ifimx.4): the real
// Talk line with a fake speech recogniser and voice-kit's honest speech synthesiser, over a Dexie that keeps the
// Ideas only answer. The delivery of a turn and of a Call me request are doubles; Date is frozen.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { db } from '../../src/data/db';
import { settingsRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { stop as stopSpeaking } from '../../src/services/speech';
import { publicKeyHexFromMasterKey } from '../../src/services/vault';
import { forgetSilentInputs } from 'voice-kit/composer';
import { installHonestSpeech, type HonestSpeech } from '../../tests/support/honest-speech';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';
import type { TalkTurn } from '../../src/model/talkLine';

const sendTurn = vi.fn();
const sendCallRequest = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendTurn: (...args: unknown[]) => sendTurn(...args),
  sendCallRequest: (...args: unknown[]) => sendCallRequest(...args),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

class Recognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  started = false;
  start() {
    this.started = true;
    recognizers.push(this);
    queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
}
let recognizers: Recognizer[] = [];

class FakeAudio {
  loop = false;
  constructor(public src: string) {}
  play() {
    return Promise.resolve();
  }
  pause() {}
}

const KEY = new Uint8Array(32).fill(7);
const HIM = publicKeyHexFromMasterKey(KEY);
const secs = (iso: string): number => new Date(iso).getTime() / 1000;

let speech: HonestSpeech | null = null;

async function start(until: string | null): Promise<void> {
  cleanup();
  stopSpeaking();
  vi.unstubAllGlobals();
  thawClock();
  freezeClock('2026-10-01T14:00:00');
  recognizers = [];
  sendTurn.mockReset();
  sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
  sendCallRequest.mockReset();
  sendCallRequest.mockResolvedValue({ txid: 'direct:call', channel: 'direct' });
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  const at = until ? secs(until) : 0;
  await settingsRepo.setIdeasOnly({ key: HIM, setting: { until: at, reaches: {} }, state: until ? { on: true, until: at, by: 'until' } : { on: false, until: 0, by: '' }, at: 0 });
  setKey(KEY);
  forgetSilentInputs();
  speech?.uninstall();
  speech = installHonestSpeech();
  vi.stubGlobal('webkitSpeechRecognition', Recognizer);
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = Recognizer;
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  window.history.replaceState(null, '', '/?v=line');
}

afterAll(() => {
  cleanup();
  lock();
  thawClock();
  speech?.uninstall();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const talkButton = (name: string) => screen.findByRole('button', { name });
const heard = () => speech?.log.map((entry) => entry.text) ?? [];

const feature = await loadFeature('features/ideas-only-talk.feature');

describeFeature(feature, ({ Scenario }) => {
  const on = () => start('2026-10-01T21:00:00');
  const off = () => start(null);
  const lineOpen = async () => {
    render(<TalkLineScreen />);
    await talkButton('Hold to talk');
  };
  const holdAndSay = async (_c: unknown, words: string) => {
    fireEvent.pointerDown(await talkButton('Hold to talk'));
    await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
    act(() => recognizers.at(-1)?.onresult?.({ results: [[{ transcript: words }]] }));
    fireEvent.pointerUp(await talkButton('Release to send'));
    await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
  };
  const turnSent = (_c: unknown, words: string) => {
    expect((sendTurn.mock.calls.at(-1)?.[0] as TalkTurn).text).toBe(words);
  };
  const voiceSays = async (_c: unknown, words: string) => {
    await waitFor(() => expect(heard()).toContain(words));
  };

  Scenario('mw-8ifimx.4 AC-3: a turn with the mode on is recorded, spoken, and the line is idle at once', ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string}', holdAndSay);
    Then('the turn {string} was sent', turnSent);
    And('the voice says {string}', voiceSays);
    And('under his turn it says {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('talk-recorded')).toHaveTextContent(words));
    });
    And('the talk button reads {string} again', async (_c, name: string) => {
      expect(await talkButton(name)).toBeEnabled();
    });
    And('the line is not waiting for the Mayor', () => {
      expect(screen.queryByRole('button', { name: 'Waiting for the Mayor…' })).toBeNull();
      expect(screen.queryByText('Sent.')).toBeNull();
    });
  });

  Scenario('mw-8ifimx.4 AC-3: a Call me request with the mode on says the same', ({ Given, And, When, Then }) => {
    Given("Ideas only is on until 21:00 and the phone's clock says 14:00", on);
    And('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he asks the Mayor to call him', async () => {
      fireEvent.click(await talkButton('Call me'));
      await screen.findByRole('textbox', { name: 'What to tell the Mayor' });
      fireEvent.click(await talkButton('Send'));
    });
    Then('the Call me request was sent', async () => {
      await waitFor(() => expect(sendCallRequest).toHaveBeenCalledTimes(1));
    });
    And('the voice says {string}', voiceSays);
    And('the call line says {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('call-recorded')).toHaveTextContent(words));
    });
  });

  Scenario('mw-8ifimx.4 AC-3: with the mode off the line waits for the Mayor as before', ({ Given, And, When, Then }) => {
    Given("Ideas only is off and the phone's clock says 14:00", off);
    And('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string}', holdAndSay);
    Then('the turn {string} was sent', turnSent);
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    And('nothing is recorded or spoken', () => {
      expect(screen.queryByTestId('talk-recorded')).toBeNull();
      expect(heard()).toEqual([]);
    });
  });
});
