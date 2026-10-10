// features/steps/read-aloud-stop.steps.tsx — runs features/read-aloud-stop.feature (mw-ym1qi9.1):
// every read-aloud speaker toggles between reading and stopping.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { Shell } from '../../src/cockpit/Shell';
import { navigate, useRoute } from '../../src/router';
import { getSpeech, stop } from '../../src/services/speech';
import { db } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import type { MessageRow } from '../../src/data/repositories';
import type { Need } from '../../src/model/view';
import { installHonestSpeech, type HonestSpeech } from '../../tests/support/honest-speech';
import { fixtureView } from '../../tests/support/cockpit-fixture';

// The phone's voice is bsv-kit's honest speech synthesiser (mw-it6qk5.4), watched for its cancels.
let speech: HonestSpeech | null = null;
let cancelFn = vi.fn();
const spoken = (): string[] => speech?.log.map((entry) => entry.text) ?? [];

const BEAD = 'mw-f758y.31';
let now = Date.now();
let seeded: MessageRow[] = [];

function generalMessage(n: number, text: string): MessageRow {
  const txid = n.toString(16).padStart(2, '0').repeat(32);
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: n,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(now / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
  };
}

const need: Need = {
  kind: 'alarm',
  bead: '',
  epic: '',
  title: 'Doctor: disk almost full',
  since: new Date().toISOString(),
  text: 'The disk is at ninety percent.',
  recommended: '',
  options: [],
  blocks: 0,
  steps: [],
} as Need;

// The shell with a screen to leave for: the general thread at ?v=talk, anything else is another screen.
// eslint-disable-next-line react-refresh/only-export-components
function RoutedShell() {
  const route = useRoute();
  return <Shell route={route}>{route.view === 'talk' ? <TalkScreen thread="general" /> : <p>Another screen</p>}</Shell>;
}

async function openGeneral(inShell = false): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  render(inShell ? <RoutedShell /> : <TalkScreen thread="general" />);
  await screen.findByTestId('conversation');
}

const tap = async (name: string, nth = 0) => {
  const buttons = await screen.findAllByRole('button', { name });
  await userEvent.click(buttons[nth]);
};

afterAll(() => {
  cleanup();
  stop();
  speech?.uninstall();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/read-aloud-stop.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    now = Date.now();
    seeded = [];
    speech?.uninstall();
    speech = installHonestSpeech();
    cancelFn = vi.spyOn(speech.synth, 'cancel');
    stop();
    cancelFn.mockClear();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    window.history.replaceState(null, '', '/?v=talk&t=general');
  });

  const starts = async (_c: unknown, label: string) => {
    // a text of several sentences is queued as one utterance each (mw-q6n8m0.9)
    expect(spoken().length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
  };
  const stops = async (_c: unknown, label: string) => {
    await waitFor(() => expect(cancelFn).toHaveBeenCalledTimes(2)); // once to start (it clears the floor), once to stop
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop reading' })).not.toBeInTheDocument();
  };

  Scenario("mw-ym1qi9.1 AC1: the bead page's description speaker reads, then stops on a second tap", ({ Given, When, Then }) => {
    Given('the bead page of a bead with a description', async () => {
      const view = fixtureView(now);
      for (const bead of view.beads) if (bead.id === BEAD) bead.summary = 'Make the cockpit easy to use correctly.';
      await viewRepo.save({ plaintext: JSON.stringify(view), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
      render(<BeadScreen id={BEAD} />);
      await screen.findByRole('button', { name: 'Read the description aloud' });
    });
    When('he taps {string}', async (_c, label: string) => tap(label));
    Then('the phone starts reading and the button now says {string}', starts);
    When('he taps {string} a second time', async (_c, label: string) => tap(label));
    Then('the phone stops reading and the button says {string} again', stops);
  });

  Scenario("mw-ym1qi9.1 AC2: a Needs card's speaker reads, then stops on a second tap", ({ Given, When, Then }) => {
    Given('a Needs card with words to read', () => {
      render(<NeedCard need={need} />);
    });
    When('he taps {string}', async (_c, label: string) => tap(label));
    Then('the phone starts reading and the button now says {string}', starts);
    When('he taps {string} a second time', async (_c, label: string) => tap(label));
    Then('the phone stops reading and the button says {string} again', stops);
  });

  Scenario("mw-ym1qi9.1 AC3: a message's speaker reads, then stops on a second tap", ({ Given, When, Then }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(1, text));
    });
    When('the general thread is opened and he taps {string}', async (_c, label: string) => {
      await openGeneral();
      await tap(label);
    });
    Then('the phone starts reading and the button now says {string}', starts);
    When('he taps {string} a second time', async (_c, label: string) => tap(label));
    Then('the phone stops reading and the button says {string} again', stops);
  });

  Scenario('mw-ym1qi9.1 AC4: the speaker returns by itself when the reading ends', ({ Given, When, And, Then }) => {
    Given('a Needs card with words to read', () => {
      render(<NeedCard need={need} />);
    });
    When('he taps {string}', async (_c, label: string) => tap(label));
    And('the phone finishes reading', async () => {
      await screen.findByRole('button', { name: 'Stop reading' });
      act(() => speech!.finishAll());
    });
    Then('the button says {string} again', async (_c, label: string) => {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Stop reading' })).not.toBeInTheDocument();
    });
  });

  Scenario("mw-ym1qi9.1 AC5: starting a second speaker turns the first back to its speaker", ({ Given, When, And, Then }) => {
    Given("the Mayor's messages in the general thread are {string} and {string}", (_c, first: string, second: string) => {
      seeded.push(generalMessage(1, first), generalMessage(2, second));
    });
    When("the general thread is opened and he taps the first message's speaker", async () => {
      await openGeneral();
      await tap('Read aloud', 0);
    });
    And("he taps the second message's speaker", async () => {
      await tap('Read aloud'); // the first message's button now says Stop reading, so this is the second's
    });
    Then("only the second message's speaker says {string}", async (_c, label: string) => {
      await waitFor(() => expect(screen.getAllByRole('button', { name: label })).toHaveLength(1));
      const all = screen.getAllByRole('button', { name: /^(Read aloud|Stop reading)$/ });
      expect(all.map((b) => b.getAttribute('aria-label'))).toEqual(['Read aloud', 'Stop reading']); // thread order: first, second
      expect(spoken()).toHaveLength(2);
    });
  });

  // mw-q6n8m0.9: the speaking bar. The message's sentences are queued on the (fake) synthesiser at once, one utterance each.
  let mark = 0;
  const spokenSince = () => spoken().slice(mark);
  const barButtons = () => within(screen.getByRole('region', { name: 'Speaking' })).getAllByRole('button');
  const bar = async (_c: unknown, a: string, b: string, c: string) => {
    await screen.findByRole('region', { name: 'Speaking' });
    expect(barButtons().map((button) => button.textContent)).toEqual([a, b, c]);
    for (const button of barButtons()) expect(button.className).toContain('min-h-11');
  };
  const tapsInBar = async (_c: unknown, label: string) => {
    mark = spoken().length;
    await userEvent.click(within(await screen.findByRole('region', { name: 'Speaking' })).getByRole('button', { name: label }));
  };
  const opensInShell = async (_c: unknown, label: string) => {
    await openGeneral(true);
    await tap(label);
  };
  const speaksAgain = async (_c: unknown, ...texts: string[]) => {
    await waitFor(() => expect(spokenSince()).toEqual(texts));
  };

  Scenario('mw-q6n8m0.9 AC-3: a message\'s speaker shows the speaking bar with Pause, Resume, Restart and Stop', ({ Given, When, Then, And }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(1, text));
    });
    When('the general thread is opened in the shell and he taps {string}', opensInShell);
    Then('the speaking bar offers {string}, {string} and {string}', bar);
    When('the phone has begun the second sentence', () => {
      act(() => {
        speech!.advance(0); // the engine begins the first sentence
        speech!.finish(); // it ends and the engine begins the second
      });
    });
    And('he taps {string} in the bar', tapsInBar);
    Then('the speaking bar now offers {string}, {string} and {string}', bar);
    And("the message's button still says {string}", async (_c, label: string) => {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });
    When('he taps {string} in the bar to carry on', tapsInBar);
    Then('the phone speaks {string} and then {string} again', speaksAgain);
    When('he taps {string} in the bar to start over', tapsInBar);
    Then('the phone speaks {string} and then {string} and then {string} again', speaksAgain);
    When('he taps {string} in the bar to end it', tapsInBar);
    Then("the speaking bar is gone and the message's button says {string} again", async (_c, label: string) => {
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Speaking' })).not.toBeInTheDocument());
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  const leaves = async () => {
    act(() => navigate('?v=me'));
    await screen.findByText('Another screen');
    await waitFor(() => expect(screen.queryByTestId('conversation')).not.toBeInTheDocument());
  };
  const comesBack = async () => {
    act(() => navigate('?v=talk&t=general'));
    await screen.findByTestId('conversation');
  };
  const begunSecond = () => {
    act(() => {
      utterances[0].onstart?.();
      utterances[0].onend?.();
      utterances[1].onstart?.();
    });
  };

  Scenario('mw-q6n8m0.10 AC1: leaving the screen pauses the speech, and the bar on the next screen offers Resume at the same sentence', ({ Given, When, Then, And }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(1, text));
    });
    When('the general thread is opened in the shell and he taps {string}', opensInShell);
    And('the phone has begun the second sentence', begunSecond);
    And('he leaves for another screen', leaves);
    Then('the speech is paused, not stopped, and the speaking bar offers {string}, {string} and {string}', async (_c, a: string, b: string, c: string) => {
      expect(getSpeech()).toMatchObject({ status: 'paused', index: 1 });
      await bar(_c, a, b, c);
    });
    When('he taps {string} in the bar to carry on', tapsInBar);
    Then('the phone speaks {string} and then {string} again', speaksAgain);
  });

  Scenario('mw-q6n8m0.10 AC1: coming back to the screen still offers Resume', ({ Given, When, Then, And }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(1, text));
    });
    When('the general thread is opened in the shell and he taps {string}', opensInShell);
    And('he leaves for another screen', leaves);
    And('he comes back to the general thread', comesBack);
    Then('the speaking bar offers {string}, {string} and {string}', bar);
    And("the message's button still says {string}", async (_c, label: string) => {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  Scenario('mw-q6n8m0.10 AC2: a new read-aloud while one waits paused ends the paused one', ({ Given, When, Then, And }) => {
    Given("the Mayor's messages in the general thread are {string} and {string}", (_c, first: string, second: string) => {
      seeded.push(generalMessage(1, first), generalMessage(2, second));
    });
    When("the general thread is opened in the shell and he taps the first message's speaker", async () => {
      await openGeneral(true);
      await tap('Read aloud', 0);
    });
    And('he leaves for another screen', leaves);
    And('he comes back to the general thread', comesBack);
    And("he taps the second message's speaker", async () => {
      await tap('Read aloud');
    });
    Then("only the second message's speaker says {string}", async (_c, label: string) => {
      await waitFor(() => expect(screen.getAllByRole('button', { name: label })).toHaveLength(1));
      const all = screen.getAllByRole('button', { name: /^(Read aloud|Stop reading)$/ });
      expect(all.map((b) => b.getAttribute('aria-label'))).toEqual(['Read aloud', 'Stop reading']);
    });
    And('the speaking bar offers {string}, {string} and {string}', bar);
  });

  Scenario('mw-q6n8m0.10 AC2: Stop on a paused read-aloud ends it and the bar goes', ({ Given, When, Then, And }) => {
    Given("the Mayor's message in the general thread is {string}", (_c, text: string) => {
      seeded.push(generalMessage(1, text));
    });
    When('the general thread is opened in the shell and he taps {string}', opensInShell);
    And('he leaves for another screen', leaves);
    And('he taps {string} in the bar to end it', tapsInBar);
    Then('the speaking bar is gone and nothing is speaking', async () => {
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Speaking' })).not.toBeInTheDocument());
      expect(getSpeech().status).toBe('idle');
    });
  });
});
