// features/steps/voice-failure.steps.tsx — runs features/voice-failure.feature (mw-lcirxg): a voice that fails says why.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { db } from '../../src/data/db';
import { stop } from '../../src/services/speech';
import { failSpeech, installHonestSpeech, type HonestSpeech } from '../../tests/support/honest-speech';
import type { ConversationItem } from '../../src/model/conversation';

let speech: HonestSpeech | null = null;

afterAll(() => {
  cleanup();
  stop();
  speech?.uninstall();
});

const feature = await loadFeature('features/voice-failure.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    speech?.uninstall();
    speech = installHonestSpeech();
    stop();
    await Promise.all([db.settings.clear(), db.view.clear()]);
  });

  const refuses = (_c: unknown, error: string) => failSpeech(speech!, error);
  const meOpen = () => {
    render(<MeScreen />);
  };
  const tapsTest = async () => userEvent.click(await screen.findByRole('button', { name: 'Test voice' }));
  const meSays = async (_c: unknown, text: string) => {
    act(() => speech!.advance(0));
    expect(await screen.findByText(text)).toBeInTheDocument();
  };

  Scenario('mw-lcirxg AC1: a message the phone\'s voice fails to speak shows why under it and keeps its Play button', ({ Given, And, When, Then }) => {
    Given("the phone's voice engine refuses to speak with {string}", refuses);
    And("the Mayor's message {string} is shown", (_c, text: string) => {
      const item = { id: 'm1', speaker: 'mayor', speakerLabel: 'Mayor', kind: 'text', text, at: Date.now(), onChain: false } as unknown as ConversationItem;
      render(<Conversation items={[item]} />);
    });
    When('he taps {string} on the message', async (_c, label: string) => userEvent.click(await screen.findByRole('button', { name: label })));
    Then('the message says {string}', meSays);
    And('the message still has a {string} button', async (_c, label: string) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  Scenario("mw-lcirxg AC2: Me's Test voice speaks one sentence and says Spoken", ({ Given, When, And, Then }) => {
    Given('Me is open', meOpen);
    When('he taps {string}', tapsTest);
    And('the phone finishes speaking', () => {
      act(() => speech!.finishAll());
    });
    Then('Me says {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  Scenario("mw-lcirxg AC2: Me's Test voice shows the same note when the phone's voice fails", ({ Given, And, When, Then }) => {
    Given("the phone's voice engine refuses to speak with {string}", refuses);
    And('Me is open', meOpen);
    When('he taps {string}', tapsTest);
    Then('Me says {string}', meSays);
  });
});
