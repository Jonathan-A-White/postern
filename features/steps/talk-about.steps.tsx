// features/steps/talk-about.steps.tsx — runs features/talk-about.feature (mw-nqur1n.6):
// a Talk button on a decision card, a hands step, a channel's header and a Prompts row opens
// the Talk line about it; the first turn's record carries `about`; Clear drops it.
import '@testing-library/react/dont-cleanup-after-each';
import { act, render, screen, cleanup, waitFor, within, fireEvent, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Utils } from '@bsv/sdk';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { PromptsScreen } from '../../src/cockpit/PromptsScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { TalkLineScreen } from '../../src/cockpit/TalkLineScreen';
import { useRoute } from '../../src/router';
import { setKey, lock } from '../../src/services/keySession';
import { db } from '../../src/data/db';
import { formatRoute, parseRoute, type Route } from '../../src/nav/route';
import { decodeTurn, encodeTurn } from '../../src/services/talk';
import { forgetSilentInputs } from 'bsv-kit/composer';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { handsStep } from '../../tests/support/cockpit-fixture';
import type { Need } from '../../src/model/view';
import type { TalkTurn } from '../../src/model/talkLine';

configure({ asyncUtilTimeout: 5000 });

const HIM_KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));

const sendTurn = vi.fn();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendTurn: (...args: unknown[]) => sendTurn(...args),
}));
vi.mock('../../src/services/presence', () => ({ fetchMayorHere: () => Promise.resolve(undefined) }));

// The browser's speech recogniser, as a fake that opens its mic and hears what a step says.
let recognizers: FakeRecognizer[] = [];
class FakeRecognizer {
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

function installBrowser(): void {
  recognizers = [];
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer;
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
  Object.defineProperty(navigator, 'wakeLock', { value: { request: () => Promise.resolve({ release: () => Promise.resolve() }) }, configurable: true, writable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
}

const hear = (text: string) =>
  act(() => {
    recognizers.at(-1)?.onresult?.({ results: [[{ transcript: text }]] });
  });

async function holdAndSay(words: string): Promise<void> {
  const before = sendTurn.mock.calls.length;
  const button = await screen.findByRole('button', { name: 'Hold to talk' });
  fireEvent.pointerDown(button);
  await waitFor(() => expect(recognizers.at(-1)?.started).toBe(true));
  await hear(words);
  fireEvent.pointerUp(button);
  await waitFor(() => expect(sendTurn.mock.calls.length).toBe(before + 1));
}

const lastSent = () => sendTurn.mock.calls.at(-1)?.[0] as TalkTurn;

function backendHas(...names: string[]): void {
  const prompts = names.map((name) => ({ name, summary: `About ${name}`, signature: [], body: 'x', updatedAt: '2026-10-01T12:00:00Z', updatedBy: '02'.padEnd(66, '0') }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (isChallengeRequest(target)) return challengeResponse();
      if (target.endsWith('/prompts')) return new Response(JSON.stringify(prompts), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"v1"' } });
      return new Response('{}', { status: 404 });
    }),
  );
}

// What the places stand in for: a card, the prompts, the channel and the line.
let card: Need | undefined;
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  if (route.view === 'line') return <TalkLineScreen />;
  if (route.view === 'talk') return <TalkScreen thread={route.thread} root={route.root} prefill={route.prefill} />;
  if (route.view === 'prompts') return <PromptsScreen />;
  return card ? <NeedCard need={card} /> : <div>Needs place</div>;
}

const needOf = (patch: Partial<Need>): Need => ({ kind: 'question', bead: 'mw-card', epic: '', title: 'Pick the colour', since: new Date().toISOString(), text: '', recommended: '', options: ['Blue', 'Green'], blocks: 0, steps: [], ...patch });

async function fresh(): Promise<void> {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  card = undefined;
  sendTurn.mockReset();
  sendTurn.mockResolvedValue({ txid: 'direct:x', channel: 'direct' });
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear(), db.outbox.clear()]);
  forgetSilentInputs();
  installBrowser();
  setKey(HIM_KEY);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-about.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const decisionCard = (_c: unknown, title: string, bead: string) => {
    card = needOf({ title, bead });
  };
  const tapOnCard = async () => {
    render(<Harness />);
    const article = await screen.findByTestId('need-card');
    await userEvent.click(within(article).getAllByRole('button', { name: 'Talk' }).at(-1)!);
  };
  const lineOpen = async () => {
    await screen.findByRole('button', { name: 'Hold to talk' });
    expect(new URLSearchParams(window.location.search).get('v')).toBe('line');
  };
  const aboutIs = async (_c: unknown, words: string) => {
    expect(await screen.findByTestId('talk-about')).toHaveTextContent(words);
  };
  const says = async (_c: unknown, words: string) => holdAndSay(words);
  const aboutOf = (_c: unknown, kind: string, id: string, title: string) => {
    expect(lastSent().about).toEqual({ kind, id, title });
  };
  const noAbout = () => {
    expect(lastSent().about).toBeUndefined();
  };

  Scenario("mw-nqur1n.6: Talk on a decision card opens the line about the card's title", ({ Given, When, Then, And }) => {
    Given('a decision card {string} on the bead {string}', decisionCard);
    When('Talk is tapped on the card', tapOnCard);
    Then('the Talk line is open', lineOpen);
    And('the line says {string}', aboutIs);
  });

  Scenario("mw-nqur1n.6: the first turn's record carries about, the next turn does not", ({ Given, When, Then, And }) => {
    Given('a decision card {string} on the bead {string}', decisionCard);
    When('Talk is tapped on the card', tapOnCard);
    And('he holds the button and says {string}', says);
    Then('the turn sent is turn 1 and its about is kind {string}, id {string}, title {string}', (_c, kind: string, id: string, title: string) => {
      expect(lastSent().talk.turn).toBe(1);
      aboutOf(_c, kind, id, title);
    });
    When('he holds the button again and says {string}', async (_c, words: string) => {
      // The Mayor's answer to turn 1 arrives, so the line is idle again.
      act(() => undefined);
      const sent = lastSent();
      const { messagesRepo } = await import('../../src/data/repositories');
      await messagesRepo.put({
        id: 'direct:a1:0',
        txid: 'direct:a1',
        vout: 0,
        seq: 1,
        class: 'talk',
        to: '03'.padEnd(66, '0'),
        from: '02'.padEnd(66, '0'),
        ts: 1_760_000_001,
        ciphertext: '',
        plaintext: encodeTurn({ talk: sent.talk, text: 'Blue then.', role: 'answer' }),
        direction: 'received',
        read: true,
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeEnabled());
      // The answer is spoken (there is no synthesis here), then the line is idle.
      await holdAndSay(words);
    });
    Then('the turn sent is turn 2 and carries no about', () => {
      expect(lastSent().talk.turn).toBe(2);
      noAbout();
    });
  });

  Scenario('mw-nqur1n.6: Talk on a step for his hands opens the line about the bead', ({ Given, When, Then }) => {
    Given('a card of hands on the bead {string} titled {string} with the step {string}', (_c, bead: string, title: string, id: string) => {
      card = needOf({ kind: 'hands', bead, title, options: [], steps: [handsStep(bead, { id, host: 'laptop', as: 'you', run: 'echo hi' })] });
    });
    When('Talk is tapped on the step {string}', async (_c, id: string) => {
      render(<Harness />);
      const step = await screen.findByLabelText(`Step ${id}`);
      await userEvent.click(within(step).getByRole('button', { name: 'Talk' }));
    });
    Then('the line says {string}', aboutIs);
    When('he holds the button and says {string}', says);
    Then('the turn sent is turn 1 and its about is kind {string}, id {string}, title {string}', aboutOf);
  });

  Scenario("mw-nqur1n.6: Talk in a named channel's header opens the line about the channel", ({ Given, When, Then }) => {
    Given('the channel {string} is open', (_c, name: string) => {
      window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(`topic:${name}`)}`);
    });
    When('Talk is tapped in the header', async () => {
      render(<Harness />);
      await userEvent.click(await screen.findByRole('button', { name: 'Talk' }));
    });
    Then('the line says {string}', aboutIs);
    When('he holds the button and says {string}', says);
    Then('the turn sent is turn 1 and its about is kind {string}, id {string}, title {string}', aboutOf);
  });

  Scenario('mw-nqur1n.6: Talk on a Prompts row carries kind prompt', ({ Given, When, Then }) => {
    Given('the prompts screen lists {string}', (_c, name: string) => {
      backendHas(name);
      window.history.replaceState(null, '', '/?v=prompts');
    });
    When('Talk is tapped on the row {string}', async (_c, name: string) => {
      render(<Harness />);
      const row = await screen.findByTestId(`prompt-${name.slice(1)}`);
      await userEvent.click(within(row).getByRole('button', { name: 'Talk' }));
    });
    Then('the line says {string}', aboutIs);
    When('he holds the button and says {string}', says);
    Then('the turn sent is turn 1 and its about is kind {string}, id {string}, title {string}', aboutOf);
  });

  Scenario('mw-nqur1n.6: Clear drops the about', ({ Given, When, Then, And }) => {
    Given('a decision card {string} on the bead {string}', decisionCard);
    When('Talk is tapped on the card', tapOnCard);
    And('Clear is tapped beside the about', async () => {
      await userEvent.click(within(await screen.findByTestId('talk-about')).getByRole('button', { name: 'Clear' }));
    });
    Then('the line says no About', async () => {
      await waitFor(() => expect(screen.queryByTestId('talk-about')).toBeNull());
    });
    When('he holds the button and says {string}', says);
    Then('the turn sent is turn 1 and carries no about', () => {
      expect(lastSent().talk.turn).toBe(1);
      noAbout();
    });
  });

  let turn: TalkTurn;
  let decoded: TalkTurn | undefined;
  Scenario("mw-nqur1n.6: an about survives the turn's encoding and is left out when there is none", ({ Given, When, Then, And }) => {
    Given('a turn 1 of talk {string} about the bead {string} titled {string}', (_c, id: string, bead: string, title: string) => {
      turn = { talk: { id, turn: 1 }, text: 'Hello', role: 'turn', about: { kind: 'bead', id: bead, title } };
    });
    When('the turn is encoded and decoded', () => {
      decoded = decodeTurn(encodeTurn(turn));
    });
    Then('the decoded turn still says it is about the bead {string} titled {string}', (_c, bead: string, title: string) => {
      expect(decoded?.about).toEqual({ kind: 'bead', id: bead, title });
    });
    And('a turn with a malformed about decodes without one', () => {
      const plain = { talk: { id: 't', turn: 1 }, text: 'x', role: 'turn' };
      for (const about of [{ kind: 'nope', id: 'a', title: 'b' }, { kind: 'bead', id: '', title: 'b' }, { kind: 'bead', id: 'a' }, 'text']) {
        const got = decodeTurn(JSON.stringify({ ...plain, about }));
        expect(got).toBeDefined();
        expect(got?.about).toBeUndefined();
      }
    });
  });

  let route: Route;
  Scenario("mw-nqur1n.6: the line's address carries the about and reads it back", ({ Given, Then }) => {
    Given('the line address for the prompt {string} titled {string}', (_c, id: string, title: string) => {
      route = { view: 'line', about: { kind: 'prompt', id, title } };
    });
    Then('reading that address gives the same about', () => {
      expect(parseRoute(formatRoute(route))).toEqual(route);
      expect(parseRoute('?v=line&ak=bead&ai=x')).toEqual({ view: 'line' });
    });
  });
});
