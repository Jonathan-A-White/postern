// features/steps/talk-screen.steps.tsx — runs features/talk-screen.feature
// (mw-j0f2d.8): the Talk line screen with a fake speech recogniser, fake speech
// synthesis, vibration and wake lock, over a Dexie that holds the Mayor's answers;
// and the Channels tab and button that lead to it.
import '@testing-library/react/dont-cleanup-after-each';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Shell } from '../../src/cockpit/Shell';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { formatRoute, parseRoute, topViewOf } from '../../src/nav/route';
import { navigate, useRoute } from '../../src/router';
import { encodeTurn } from '../../src/services/talk';
import { TURN_TEXT_MAX_BYTES, type TalkTurn } from '../../src/model/talkLine';

configure({ asyncUtilTimeout: 5000 });

const clock = vi.hoisted(() => ({ at: 1_000_000 }));
vi.mock('../../src/services/clock', () => ({ now: () => clock.at }));

const sendTurn = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendTurn: (...args: unknown[]) => sendTurn(...args),
}));

// The browser's speech, vibration and wake lock, as fakes.
interface FakeRecognizer {
  lang: string;
  processLocally: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: { results: unknown[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  started: boolean;
  stopped: boolean;
}
let recognizers: FakeRecognizer[] = [];
// How the next recognisers behave: a real one says it started, and ends when stopped.
const behaviour = { opensMic: true, endsOnStop: true };
class Recognizer implements FakeRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onstart: FakeRecognizer['onstart'] = null;
  onaudiostart: FakeRecognizer['onaudiostart'] = null;
  onresult: FakeRecognizer['onresult'] = null;
  onend: FakeRecognizer['onend'] = null;
  onerror: FakeRecognizer['onerror'] = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
    recognizers.push(this);
    if (behaviour.opensMic) queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    this.stopped = true;
    if (behaviour.endsOnStop) queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.stopped = true;
  }
}
class Utterance {
  voice: unknown = null;
  onend: (() => void) | null = null;
  constructor(public text: string) {}
}
const speak = vi.fn();
const cancel = vi.fn();
const vibrate = vi.fn(() => true);
const release = vi.fn(() => Promise.resolve());
const request = vi.fn(() => Promise.resolve({ release }));

function installBrowser(listens: boolean): void {
  recognizers = [];
  behaviour.opensMic = true;
  behaviour.endsOnStop = true;
  if (listens) vi.stubGlobal('webkitSpeechRecognition', Recognizer);
  else vi.stubGlobal('webkitSpeechRecognition', undefined);
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = listens ? Recognizer : undefined;
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  Object.defineProperty(window, 'speechSynthesis', { value: { speak, cancel, getVoices: () => [] }, configurable: true, writable: true });
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true, writable: true });
}

const recogniserFails = (code: string) =>
  act(() => {
    recognizers.at(-1)?.onerror?.({ error: code });
  });

const hear = (text: string) =>
  act(() => {
    recognizers.at(-1)?.onresult?.({ results: [[{ transcript: text }]] });
  });

/** Android Chrome: every growing hypothesis is a new result, each the whole phrase so far. */
const hearGrowing = (phrase: string) =>
  act(() => {
    const words = phrase.split(' ');
    const results: unknown[] = [];
    for (let i = 1; i <= words.length; i++) {
      results.push([{ transcript: words.slice(0, i).join(' ') }]);
      recognizers.at(-1)?.onresult?.({ results: [...results] });
    }
  });

function screenIs(widthPx: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return { matches: min ? widthPx >= Number(min[1]) : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
}

// A stand-in for App's routing.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  let place;
  if (route.view === 'line') place = <TalkLineScreen />;
  else if (route.view === 'talk') place = <TalkScreen thread={route.thread} root={route.root} />;
  else place = <div>Needs place</div>;
  return <Shell route={route}>{place}</Shell>;
}

let sequence = 0;
async function mayorSays(text: string, role: TalkTurn['role'], model?: string): Promise<void> {
  const sent = sendTurn.mock.calls.at(-1)?.[0] as TalkTurn;
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  await messagesRepo.put({
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: 'talk',
    to: '03'.padEnd(66, '0'),
    from: '02'.padEnd(66, '0'),
    ts: 1_760_000_000 + sequence,
    ciphertext: '',
    plaintext: encodeTurn({ talk: sent.talk, text, role, ...(model ? { model } : {}) }),
    direction: 'received',
    read: true,
  });
}

async function fresh(): Promise<void> {
  cleanup();
  vi.unstubAllGlobals();
  sequence = 0;
  clock.at = 1_000_000;
  sendTurn.mockReset();
  sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
  for (const fake of [speak, cancel, vibrate, release, request]) fake.mockClear();
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  document.documentElement.lang = '';
  window.history.replaceState(null, '', '/?v=line');
  screenIs(390);
}

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const talkButton = (name: string) => screen.findByRole('button', { name });

async function holdAndSay(words: string): Promise<void> {
  const before = sendTurn.mock.calls.length;
  const button = await talkButton('Hold to talk');
  fireEvent.pointerDown(button);
  await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
  await hear(words);
  fireEvent.pointerUp(button);
  await waitFor(() => expect(sendTurn.mock.calls.length).toBe(before + 1));
}

const longSpeech = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 97}`).join(' ');

const lastSent = () => sendTurn.mock.calls.at(-1)?.[0] as TalkTurn;

const places = async () => {
  const nav = await screen.findByRole('navigation', { name: 'Places' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent?.replace(/^\d+/, ''))).toEqual(['Needs you', 'Map', 'Channels', 'Search', 'Me']);
};

const feature = await loadFeature('features/talk-screen.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const lineOpen = async () => {
    installBrowser(true);
    render(<Harness />);
    await talkButton('Hold to talk');
  };
  const shellOpen = async () => {
    installBrowser(true);
    window.history.replaceState(null, '', '/?v=talk');
    render(<Harness />);
    await screen.findByRole('navigation', { name: 'Places' });
  };
  const holdsButton = async () => {
    fireEvent.pointerDown(await talkButton('Hold to talk'));
    await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
  };
  const micOpens = () =>
    act(() => {
      recognizers.at(-1)?.onaudiostart?.();
    });
  const holdsAndSays = async (_c: unknown, words: string) => holdAndSay(words);
  const mayorAnswers = async (_c: unknown, text: string, model: string) => mayorSays(text, 'answer', model);
  const tapButton = async (_c: unknown, name: string) => {
    fireEvent.click(await talkButton(name));
  };
  const channelsTab = () => within(screen.getByRole('navigation', { name: 'Places' })).getByRole('link', { name: /Channels/ });
  const openAt = async (_c: unknown, search: string) => {
    await waitFor(() => expect(window.location.search).toBe(search));
  };

  Scenario('AC-1: holding the button vibrates, listens and shows what he says as he says it', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', async () => {
      fireEvent.pointerDown(await talkButton('Hold to talk'));
    });
    Then('the phone vibrates once and the recogniser is listening', async () => {
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(recognizers.at(-1)?.stopped).toBe(false);
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    When('the recogniser hears {string} so far', async (_c, words: string) => hear(words));
    Then('the live transcript reads {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript')).toHaveTextContent(words));
    });
  });

  Scenario('AC-1: an Android phone that sends each growing hypothesis as a new result shows and sends the phrase once (mw-j0f2d.12)', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', async () => {
      fireEvent.pointerDown(await talkButton('Hold to talk'));
    });
    And('the recogniser hears each growing hypothesis of {string} as a new result', async (_c, phrase: string) => {
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
      await hearGrowing(phrase);
    });
    Then('the live transcript reads exactly {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript').textContent?.trim()).toBe(words));
    });
    When('he lets go of the talk button', async () => {
      fireEvent.pointerUp(await talkButton('Release to send'));
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    });
    Then('one turn is sent saying {string} as turn 1', (_c, words: string) => {
      expect(sendTurn).toHaveBeenCalledTimes(1);
      expect(lastSent()).toMatchObject({ text: words, role: 'turn', talk: { turn: 1 } });
    });
  });

  Scenario('AC-1: a no-speech error from the recogniser while he is still holding does not end the hold (mw-j0f2d.19)', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    Then('the talk button reads {string}', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeInTheDocument());
    });
    And('the screen does not say {string}', (_c, text: string) => {
      expect(screen.queryByText(text)).toBeNull();
    });
  });

  Scenario('AC-1: a recogniser that ends by itself while he holds is started again and his earlier words are kept (mw-j0f2d.19)', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', async () => {
      fireEvent.pointerDown(await talkButton('Hold to talk'));
    });
    And('the recogniser hears {string} so far', async (_c, words: string) => {
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
      await hear(words);
    });
    And('the recogniser ends by itself', async () => {
      const before = recognizers.length;
      act(() => {
        recognizers.at(-1)?.onend?.();
      });
      await waitFor(() => expect(recognizers.length).toBe(before + 1));
    });
    And('the recogniser then hears {string} so far', async (_c, words: string) => {
      await hear(words);
    });
    Then('the talk button reads {string}', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeInTheDocument());
    });
    And('the live transcript reads exactly {string}', async (_c, words: string) => {
      await waitFor(() => expect(screen.getByTestId('live-transcript').textContent?.trim()).toBe(words));
    });
    When('he lets go of the talk button', async () => {
      fireEvent.pointerUp(await talkButton('Release to send'));
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1));
    });
    Then('one turn is sent saying {string} as turn 1', (_c, words: string) => {
      expect(sendTurn).toHaveBeenCalledTimes(1);
      expect(lastSent()).toMatchObject({ text: words, role: 'turn', talk: { turn: 1 } });
    });
  });

  Scenario('AC-1: releasing vibrates and sends his words as a turn', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the phone vibrates twice', () => {
      expect(vibrate).toHaveBeenCalledTimes(2);
    });
    And('one turn is sent saying {string} as turn 1', (_c, words: string) => {
      expect(sendTurn).toHaveBeenCalledTimes(1);
      expect(lastSent()).toMatchObject({ text: words, role: 'turn', talk: { turn: 1 } });
    });
    And('the screen shows {string} as what he said', async (_c, words: string) => {
      expect(await screen.findByTestId('talk-said')).toHaveTextContent(words);
    });
  });

  Scenario('AC-1: the thinking state shows between his release and the answer', ({ Given, When, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the screen says the Mayor is thinking', async () => {
      expect(await screen.findByText('The Mayor is thinking…')).toBeInTheDocument();
    });
  });

  Scenario('AC-1: an answer is shown and spoken aloud', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('the Mayor answers {string} on model {string}', mayorAnswers);
    Then('the screen shows {string} as the answer', async (_c, text: string) => {
      await waitFor(() => expect(screen.getByTestId('talk-answer')).toHaveTextContent(text));
    });
    And('the phone speaks {string}', async (_c, text: string) => {
      await waitFor(() => expect(speak).toHaveBeenCalled());
      expect((speak.mock.calls.at(-1)?.[0] as Utterance).text).toBe(text);
    });
  });

  /** jsdom has no layout: give the turn list a height and a place in it, and watch its scrollTo. */
  const scroller = () => screen.getByTestId('talk-scroll') as HTMLElement & { scrollTo: ReturnType<typeof vi.fn> };
  const listIsLong = () => {
    const el = scroller();
    let top = 600;
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => void (top = v), configurable: true });
    el.scrollTo = vi.fn();
    fireEvent.scroll(el);
  };
  const scrollsToEnd = async () => {
    await waitFor(() => expect(scroller().scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000, behavior: 'smooth' })));
  };
  const noNewAnswerButton = () => expect(screen.queryByRole('button', { name: 'New answer' })).toBeNull();
  const mayorAnswersInView = async (_c: unknown, text: string, model: string) => {
    scroller().scrollTo.mockClear();
    await mayorAnswers(_c, text, model);
    await screen.findByText(text);
  };

  Scenario('AC-1: an answer scrolls the turn list down to the newest item (mw-j0f2d.13)', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    And('the turn list is longer than the screen and he is reading its end', listIsLong);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('the Mayor answers {string} on model {string}', mayorAnswersInView);
    Then('the turn list scrolls down to the end', scrollsToEnd);
    And('there is no {string} button', noNewAnswerButton);
  });

  /** jsdom has no ResizeObserver: a fake whose callbacks the scenario can fire. */
  const resizeCallbacks: Array<() => void> = [];
  const browserReportsResizes = () => {
    resizeCallbacks.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
  };
  const controlsGrow = () => {
    const el = scroller();
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
    for (const callback of resizeCallbacks) callback();
  };
  const scrollsUp = () => {
    const el = scroller();
    el.scrollTop = 0;
    fireEvent.scroll(el);
  };

  Scenario('AC-1: the turn list stays on its newest answer when the controls below it change height (mw-j0f2d.23)', ({ Given, When, Then, And }) => {
    Given('the browser reports when the turn list changes size', browserReportsResizes);
    And('the Talk line is open with a believable speech recogniser', lineOpen);
    And('the turn list is longer than the screen and he is reading its end', listIsLong);
    When('the turn list gets shorter because the controls below it grew', controlsGrow);
    Then('the turn list is moved to the end again', () => {
      expect(scroller().scrollTop).toBe(1000);
    });
  });

  Scenario('AC-1: the turn list does not follow a resize once he has scrolled up to older turns (mw-j0f2d.23)', ({ Given, When, Then, And }) => {
    Given('the browser reports when the turn list changes size', browserReportsResizes);
    And('the Talk line is open with a believable speech recogniser', lineOpen);
    And('the turn list is longer than the screen and he is reading its end', listIsLong);
    When('he scrolls the turn list up to older turns', scrollsUp);
    And('the turn list gets shorter because the controls below it grew', controlsGrow);
    Then('the turn list is left where it is', () => {
      expect(scroller().scrollTop).toBe(0);
    });
  });

  Scenario('AC-1: an answer that comes while he has scrolled up does not move him, and a New answer button takes him down (mw-j0f2d.13)', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    And('the turn list is longer than the screen and he is reading its end', listIsLong);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('he scrolls the turn list up to older turns', () => {
      const el = scroller();
      el.scrollTop = 0;
      fireEvent.scroll(el);
    });
    And('the Mayor answers {string} on model {string}', mayorAnswersInView);
    Then('the turn list does not scroll', () => {
      expect(scroller().scrollTo).not.toHaveBeenCalled();
    });
    And('there is a {string} button', async (_c, name: string) => {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    });
    When('he taps {string}', async (_c, name: string) => {
      fireEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the turn list scrolls down to the end', scrollsToEnd);
    And('there is no {string} button', noNewAnswerButton);
  });

  Scenario('AC-1: a tap cuts the answer and his next turn says so', ({ Given, When, Then, And }) => {
    let cancelledBefore = 0;
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('the Mayor answers {string} on model {string}', mayorAnswers);
    And('he taps {string}', async (_c, name: string) => {
      await waitFor(() => expect(speak).toHaveBeenCalled());
      cancelledBefore = cancel.mock.calls.length;
      fireEvent.click(await talkButton(name));
    });
    Then('the speech is cancelled', async () => {
      await waitFor(() => expect(cancel.mock.calls.length).toBeGreaterThan(cancelledBefore));
    });
    When('he then holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the last turn sent is turn 2 saying {string} with a cut', (_c, words: string) => {
      expect(lastSent()).toMatchObject({ text: words, talk: { turn: 2 }, cut: true });
    });
  });

  Scenario("AC-1: the cut tag stays on his turn only until the Mayor's next answer arrives (mw-j0f2d.22)", ({ Given, When, Then, And }) => {
    const turnOf = async (words: string) => (await screen.findByText(words)).closest('[data-testid="talk-turn"]') as HTMLElement;
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('the Mayor answers {string} on model {string}', mayorAnswers);
    And('he taps {string}', async (_c, name: string) => {
      await waitFor(() => expect(speak).toHaveBeenCalled());
      fireEvent.click(await talkButton(name));
    });
    And('he then holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the turn {string} shows the tag {string}', async (_c, words: string, tag: string) => {
      const turn = await turnOf(words);
      await waitFor(() => expect(within(turn).getByText(tag)).toBeInTheDocument());
    });
    When('the Mayor answers {string} on model {string}', mayorAnswers);
    Then('the turn {string} no longer shows the tag {string}', async (_c, words: string, tag: string) => {
      const turn = await turnOf(words);
      await within(turn).findByText('Skipped.');
      expect(within(turn).queryByText(tag)).not.toBeInTheDocument();
    });
  });

  Scenario('AC-1: the model chip goes into the turn', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he picks the {string} chip', async (_c, name: string) => {
      fireEvent.click(await talkButton(name));
    });
    And('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the last turn sent is turn 1 saying {string} on model {string}', (_c, words: string, model: string) => {
      expect(lastSent()).toMatchObject({ text: words, talk: { turn: 1 }, model });
    });
  });

  Scenario('AC-1: each answered turn shows how soon the first words came', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    And('the Mayor answers {string} 2.4 seconds later', async (_c, text: string) => {
      clock.at += 2400;
      await mayorSays(text, 'answer', 'sonnet');
    });
    Then('the answer shows {string}', async (_c, text: string) => {
      await waitFor(() => expect(screen.getByTestId('talk-answer')).toHaveTextContent(text));
    });
  });

  Scenario('AC-1: a talk holds the screen awake, and End sends end and lets it go', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    Then('the screen is not held awake', () => {
      expect(request).not.toHaveBeenCalled();
    });
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the screen is held awake', async () => {
      await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
      expect(release).not.toHaveBeenCalled();
    });
    When('he taps {string}', tapButton);
    Then('the last turn sent has the role end', async () => {
      await waitFor(() => expect(lastSent().role).toBe('end'));
    });
    And('the screen is no longer held awake', async () => {
      await waitFor(() => expect(release).toHaveBeenCalled());
    });
  });

  Scenario('AC-1: a send that fails is said plainly and the button works again', ({ Given, And, When, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    And('sending a turn will fail', () => {
      sendTurn.mockRejectedValue(new Error('boom'));
    });
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: a failed send keeps his words on the screen and Try again resends them', ({ Given, And, When, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    And('sending a turn will fail', () => {
      sendTurn.mockRejectedValue(new Error('boom'));
    });
    When('he holds the talk button and says {string} and lets go', holdsAndSays);
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
    And('his words {string} are still on the screen', async (_c, words: string) => {
      expect(await screen.findByTestId('talk-said')).toHaveTextContent(words);
    });
    When('sending a turn works again', () => {
      sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
    });
    And('he taps {string}', tapButton);
    Then('the last turn sent says {string} as turn {number}', async (_c, words: string, n: number) => {
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(2));
      expect(lastSent().text).toBe(words);
      expect(lastSent().talk.turn).toBe(Number(n));
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: a hold of about 2,000 words is cut at the cap with "..." and still sent', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he holds the talk button and says {number} words and lets go', async (_c, n: number) => holdAndSay(longSpeech(Number(n))));
    Then('the last turn sent is cut at the cap and ends with {string}', (_c, tail: string) => {
      const text = lastSent().text;
      expect(text.endsWith(tail)).toBe(true);
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(TURN_TEXT_MAX_BYTES);
      expect(text.length).toBeGreaterThan(5000);
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: a browser that cannot listen says so instead of a dead button', ({ Given, Then }) => {
    Given('the Talk line is open with no speech recogniser', async () => {
      installBrowser(false);
      render(<Harness />);
      await talkButton('Hold to talk');
    });
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: the screen says Listening only once the recogniser says the mic is open', ({ Given, When, Then, And }) => {
    Given('the Talk line is open with a speech recogniser that has not opened the mic yet', async () => {
      await lineOpen();
      behaviour.opensMic = false;
    });
    When('he presses and holds the talk button', async () => {
      fireEvent.pointerDown(await talkButton('Hold to talk'));
      await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
    });
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the screen does not say {string}', (_c, text: string) => {
      expect(within(screen.getByRole('status')).queryByText(text)).toBeNull();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    When('the recogniser says the mic is open', () => micOpens());
    Then('the screen now says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the talk button now reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: an error from the recogniser during the hold ends it in words and the button works again', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    And('nothing is sent', () => {
      expect(sendTurn).not.toHaveBeenCalled();
    });
  });

  Scenario('AC-1: the recogniser is asked for a full language tag, en-US when the page names none (mw-j0f2d.24)', ({ Given, When, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', holdsButton);
    Then('the recogniser was asked for {string}', (_c, lang: string) => {
      expect(recognizers.at(-1)?.lang).toBe(lang);
    });
  });

  Scenario('AC-1: a language-not-supported error is retried once with en-US before the message shows (mw-j0f2d.24)', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser and the page language is {string}', async (_c, lang: string) => {
      document.documentElement.lang = lang;
      await lineOpen();
    });
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    And('the recogniser fails again with {string}', async (_c, code: string) => recogniserFails(code));
    Then('the latest recogniser was asked for {string}', (_c, lang: string) => {
      expect(recognizers).toHaveLength(3);
      expect(recognizers.at(-1)?.lang).toBe(lang);
    });
    And('the screen does not say {string}', (_c, text: string) => {
      expect(screen.queryByText(text)).toBeNull();
    });
    When('the recogniser fails once more with {string}', async (_c, code: string) => recogniserFails(code));
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-2: End talk is not greyed after a failed hold, and tapping it clears the message (mw-j0f2d.24)', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    And('the recogniser fails again with {string}', async (_c, code: string) => recogniserFails(code));
    Then('the screen says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the {string} button is not greyed', async (_c, name: string) => {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    });
    When('he taps {string}', tapButton);
    Then('the screen now says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: a microphone that is not allowed says how to allow it', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', lineOpen);
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    Then("the screen says how to allow the microphone in the phone's Settings", async () => {
      const said = await screen.findByText(/microphone is not allowed/i);
      expect(said).toHaveTextContent(/Settings.*Permissions.*Microphone.*Allow/);
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-1: a release the recogniser never answers gives up after three seconds', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a speech recogniser that never ends', async () => {
      await lineOpen();
      behaviour.endsOnStop = false;
    });
    When('he presses and holds the talk button', holdsButton);
    And('he lets go of the talk button', async () => {
      fireEvent.pointerUp(await screen.findByRole('button', { name: 'Release to send' }));
    });
    Then('within 4 seconds the screen says {string}', async (_c, text: string) => {
      expect(await screen.findByText(text, undefined, { timeout: 4000 })).toBeInTheDocument();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
    And('nothing is sent', () => {
      expect(sendTurn).not.toHaveBeenCalled();
    });
  });

  Scenario('AC-1: on-device recognition that fails is retried once in network mode, and the screen says so', ({ Given, When, And, Then }) => {
    Given('the Talk line is open with a believable speech recogniser', async () => {
      await lineOpen();
      behaviour.opensMic = false;
    });
    When('he presses and holds the talk button', holdsButton);
    And('the recogniser fails with {string}', async (_c, code: string) => recogniserFails(code));
    Then('a second recogniser is listening in network mode', async () => {
      await waitFor(() => expect(recognizers).toHaveLength(2));
      expect(recognizers[0].processLocally).toBe(true);
      expect(recognizers[1].processLocally).toBe(false);
    });
    And('the screen says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    When('the recogniser says the mic is open', () => micOpens());
    Then('the screen now says {string}', async (_c, text: string) => {
      expect(await within(await screen.findByRole('status')).findByText(text)).toBeInTheDocument();
    });
    And('the talk button reads {string}', async (_c, name: string) => {
      expect(await talkButton(name)).toBeInTheDocument();
    });
  });

  Scenario('AC-3: the bottom tab that lists the channels is called Channels', ({ Given, Then, And }) => {
    Given('the cockpit shell on a phone with the Channels place open', shellOpen);
    Then('the bottom menu offers {string}, {string}, {string}, {string} and {string}', places);
    And('no screen calls the channel list {string}', async (_c, word: string) => {
      expect(await screen.findByRole('heading', { name: 'Channels' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: word })).toBeNull();
      expect(within(screen.getByRole('navigation', { name: 'Places' })).queryByText(word)).toBeNull();
    });
  });

  Scenario('AC-3: the Channels place offers a Talk to the Mayor button', ({ Given, When, Then }) => {
    Given('the cockpit shell on a phone with the Channels place open', shellOpen);
    When('he taps {string}', async (_c, name: string) => {
      fireEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the Talk line is open at ?v=line', async () => {
      await openAt(undefined, '?v=line');
      expect(await talkButton('Hold to talk')).toBeInTheDocument();
    });
  });

  Scenario('AC-3: a long press on the Channels tab vibrates and opens the Talk line', ({ Given, When, Then, And }) => {
    Given('the cockpit shell on a phone with the Channels place open', shellOpen);
    When('he long presses the {string} tab', async () => {
      const tab = channelsTab();
      fireEvent.pointerDown(tab);
      await new Promise((resolve) => setTimeout(resolve, 650));
      fireEvent.pointerUp(tab);
      fireEvent.click(tab);
    });
    Then('the phone vibrates once', () => {
      expect(vibrate).toHaveBeenCalledTimes(1);
    });
    And('the Talk line is open at ?v=line', async () => {
      await openAt(undefined, '?v=line');
      expect(await talkButton('Hold to talk')).toBeInTheDocument();
    });
  });

  Scenario('AC-3: a short tap on the Channels tab opens the channel list as before', ({ Given, And, When, Then }) => {
    Given('the cockpit shell on a phone with the Channels place open', shellOpen);
    And('he is on the Needs place', async () => {
      act(() => navigate({ view: 'needs' }));
      await screen.findByText('Needs place');
    });
    When('he taps the {string} tab', () => {
      const tab = channelsTab();
      fireEvent.pointerDown(tab);
      fireEvent.pointerUp(tab);
      fireEvent.click(tab);
    });
    Then('the channel list is open at ?v=talk', async () => {
      await openAt(undefined, '?v=talk');
      expect(await screen.findByRole('heading', { name: 'Channels' })).toBeInTheDocument();
    });
    And('the phone has not vibrated', () => {
      expect(vibrate).not.toHaveBeenCalled();
    });
  });

  Scenario('AC-3: the Talk line is a place of its own under the Channels tab', ({ Then }) => {
    Then('the route ?v=line is the Talk line and belongs to the Channels tab', () => {
      expect(parseRoute('?v=line')).toEqual({ view: 'line' });
      expect(formatRoute({ view: 'line' })).toBe('?v=line');
      expect(topViewOf({ view: 'line' })).toBe('talk');
    });
  });
});
