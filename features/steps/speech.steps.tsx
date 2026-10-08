// features/steps/speech.steps.tsx — runs features/speech.feature (mw-xhtcup.13): the Read-aloud
// control follows speech support, leaving a screen stops its speech, and a need reads its options.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { stop } from '../../src/services/speech';
import { db } from '../../src/data/db';
import type { Need } from '../../src/model/view';

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

function need(over: Partial<Need> = {}): Need {
  return {
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
    ...over,
  } as Need;
}

let unmount: () => void = () => undefined;

afterAll(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const feature = await loadFeature('features/speech.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    vi.unstubAllGlobals();
    utterances.length = 0;
    speakFn.mockClear();
    cancelFn.mockClear();
    await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  });

  const supported = () => {
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', { speak: speakFn, cancel: cancelFn, getVoices: () => [] });
    stop();
    cancelFn.mockClear();
  };

  Scenario('mw-xhtcup.13 AC1: a phone with no speech synthesis shows no Read-aloud control', ({ Given, When, Then }) => {
    Given('the phone has no speech synthesis', () => {
      Reflect.deleteProperty(window, 'speechSynthesis');
    });
    When('a Needs card is shown', async () => {
      render(<NeedCard need={need()} />);
      await screen.findByRole('article');
    });
    Then('no Read-aloud control is shown', () => {
      expect(screen.queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument();
    });
  });

  Scenario('mw-xhtcup.13 AC2: leaving the screen stops the speech', ({ Given, And, When, Then }) => {
    Given('the phone supports speech synthesis', supported);
    And('a Needs card is shown and he has tapped {string}', async (_c, label: string) => {
      unmount = render(<NeedCard need={need()} />).unmount;
      await userEvent.click(await screen.findByRole('button', { name: label }));
      expect(speakFn).toHaveBeenCalledTimes(1);
      cancelFn.mockClear();
    });
    When('the screen is left', () => unmount());
    Then('the speech is cancelled once', () => {
      expect(cancelFn).toHaveBeenCalledTimes(1);
    });
  });

  Scenario('mw-xhtcup.13 AC3: a question reads as the question, the recommendation, then the options', ({ Given, And, When, Then }) => {
    Given('the phone supports speech synthesis', supported);
    And('a Needs card asks {string} with options {string} and {string}, recommending {string}', async (_c, title: string, a: string, b: string, recommended: string) => {
      render(<NeedCard need={need({ kind: 'question', title, text: '', options: [a, b], recommended })} />);
      await screen.findByRole('article');
    });
    When('he taps {string}', async (_c, label: string) => {
      await userEvent.click(await screen.findByRole('button', { name: label }));
    });
    Then('the phone says the question, then {string}, then {string}', (_c, recommends: string, options: string) => {
      expect(utterances).toHaveLength(1);
      const said = utterances[0].text;
      expect(said).toContain('Release the held story?');
      expect(said.indexOf('Release the held story?')).toBeLessThan(said.indexOf(recommends));
      expect(said.indexOf(recommends)).toBeLessThan(said.indexOf(options));
      expect(said.endsWith(options)).toBe(true);
    });
  });
});
