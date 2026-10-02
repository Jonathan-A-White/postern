// features/steps/read-aloud-stop.steps.tsx — runs features/read-aloud-stop.feature (mw-ym1qi9.1):
// every read-aloud speaker toggles between reading and stopping.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { stop } from '../../src/services/speech';
import { db } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import type { MessageRow } from '../../src/data/repositories';
import type { Need } from '../../src/model/view';
import { fixtureView } from '../../tests/support/cockpit-fixture';

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const utterances: FakeUtterance[] = [];
const speakFn = vi.fn((u: FakeUtterance) => utterances.push(u));
const cancelFn = vi.fn();

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

async function openGeneral(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify(fixtureView(now)), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  render(<TalkScreen thread="general" />);
  await screen.findByTestId('conversation');
}

const tap = async (name: string, nth = 0) => {
  const buttons = await screen.findAllByRole('button', { name });
  await userEvent.click(buttons[nth]);
};

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/read-aloud-stop.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    now = Date.now();
    seeded = [];
    utterances.length = 0;
    speakFn.mockClear();
    cancelFn.mockClear();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak: speakFn, cancel: cancelFn, getVoices: () => [] });
    stop();
    cancelFn.mockClear();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
    window.history.replaceState(null, '', '/?v=talk&t=general');
  });

  const starts = async (_c: unknown, label: string) => {
    expect(speakFn).toHaveBeenCalledTimes(1);
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
      act(() => utterances[0].onend?.());
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
      expect(speakFn).toHaveBeenCalledTimes(2);
    });
  });
});
