// features/steps/answered-conversation.steps.tsx — runs the mw-f758y.32 scenarios of
// features/answered-once.feature: a question is answered once, in the conversation and on a
// Needs card; the answered state is read from the answers this phone sent, so it survives a reload.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import type { ConversationItem } from '../../src/model/conversation';
import type { Need } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const sendAnswer = vi.fn<(bead: string, answer: string) => Promise<{ txid: string; channel: string }>>();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendAnswer: (bead: string, answer: string) => sendAnswer(bead, answer),
}));

const BEAD = 'mw-q';
const HH_MM = /\d{2}:\d{2}/;

let items: ConversationItem[] = [];

function asked(id: string, options: string[], minutesAgo: number): ConversationItem {
  return {
    id,
    at: Date.now() - minutesAgo * 60_000,
    speaker: 'mayor',
    speakerLabel: 'Mayor',
    kind: 'question',
    text: 'Shall we?',
    question: { bead: BEAD, q: 'Shall we?', rec: '', options },
    source: 'message',
  };
}

function answeredItem(answer: string, minutesAgo: number): ConversationItem {
  return { id: `a:${answer}:${minutesAgo}`, at: Date.now() - minutesAgo * 60_000, speaker: 'you', speakerLabel: 'You', kind: 'answer', text: answer, answer, answerBead: BEAD, source: 'message' };
}

function need(options: string[], sinceMinutesAgo: number): Need {
  return { kind: 'question', bead: BEAD, epic: '', title: 'Paint the door', since: new Date(Date.now() - sinceMinutesAgo * 60_000).toISOString(), text: 'Shall we?', recommended: '', options, blocks: 0, steps: [] };
}

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  sendAnswer.mockReset();
  sendAnswer.mockResolvedValue({ txid: 'direct:aa', channel: 'direct' });
  items = [];
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  window.history.replaceState(null, '', '/');
}

afterAll(() => {
  cleanup();
});

const options = () => within(screen.getByTestId('conversation')).getAllByRole('button').filter((button) => !button.getAttribute('aria-label'));

const feature = await loadFeature('features/answered-once.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-f758y.32: a question in the conversation answers once and a second tap sends nothing', ({ Given, When, And, Then }) => {
    Given('a question in the conversation with the options {string} and {string}', async (_c, a: string, b: string) => {
      items = [asked('q1', [a, b], 2)];
      render(<Conversation items={items} />);
    });
    When('he taps {string} in the conversation', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
    });
    And('he taps {string} again in the conversation', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
    });
    Then('the conversation sent one answer, {string}', async (_c, answer: string) => {
      await waitFor(() => expect(sendAnswer).toHaveBeenCalledTimes(1));
      expect(sendAnswer).toHaveBeenCalledWith(BEAD, answer);
    });
    And("the conversation's options are disabled", async () => {
      await waitFor(() => {
        const buttons = within(screen.getByTestId('message')).getAllByRole('button').filter((b) => ['Yes', 'No'].includes(b.textContent ?? ''));
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeDisabled();
      });
    });
    And('the conversation card says {string} and the time as HH:MM', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(new RegExp(`${line} ${HH_MM.source}`)));
    });
  });

  Scenario('mw-f758y.32: a question answered before a reload still reads answered', ({ Given, When, Then, And }) => {
    Given('a question in the conversation that he answered {string} a minute after it was asked', async (_c, answer: string) => {
      items = [asked('q1', ['Yes', 'No'], 5), answeredItem(answer, 4)];
    });
    When('the conversation is shown', async () => {
      render(<Conversation items={items} />);
    });
    Then("the conversation's options are disabled", async () => {
      const buttons = screen.getAllByRole('button').filter((b) => ['Yes', 'No'].includes(b.textContent ?? ''));
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button).toBeDisabled();
    });
    And('the conversation card says {string} and the time as HH:MM', async (_c, line: string) => {
      expect(screen.getByRole('status').textContent).toMatch(new RegExp(`${line} ${HH_MM.source}`));
    });
  });

  Scenario("mw-f758y.32: a second question on the bead is not held by the first one's answer", ({ Given, When, Then }) => {
    Given('a conversation whose first question he answered {string}, and which asked a second one', async (_c, answer: string) => {
      items = [asked('q1', ['Yes', 'No'], 20), answeredItem(answer, 19), asked('q2', ['Red', 'Blue'], 5)];
    });
    When('the conversation is shown', async () => {
      render(<Conversation items={items} />);
    });
    Then('the first card says {string} and the second card offers {string} and {string}', async (_c, line: string, a: string, b: string) => {
      const [first, second] = screen.getAllByTestId('message');
      expect(first.textContent).toContain(line);
      expect(within(second).getByRole('button', { name: a })).toBeEnabled();
      expect(within(second).getByRole('button', { name: b })).toBeEnabled();
      expect(second.textContent).not.toContain('Answered');
    });
  });

  Scenario('mw-f758y.32: an answer that failed to send leaves the card tappable and says so', ({ Given, And, When, Then }) => {
    Given('a question in the conversation with the options {string} and {string}', async (_c, a: string, b: string) => {
      items = [asked('q1', [a, b], 2)];
      render(<Conversation items={items} />);
    });
    And('sending an answer fails', async () => {
      sendAnswer.mockRejectedValue(new Error('offline'));
    });
    When('he taps {string} in the conversation', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
    });
    Then("the conversation's options are enabled", async () => {
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(options().filter((b) => ['Yes', 'No'].includes(b.textContent ?? ''))).toHaveLength(2);
      for (const button of options().filter((b) => ['Yes', 'No'].includes(b.textContent ?? ''))) expect(button).toBeEnabled();
    });
    And('the conversation card reads {string}', async (_c, line: string) => {
      expect(screen.getByRole('alert').textContent).toContain(line);
    });
  });

  Scenario("mw-f758y.32: a needs card whose answer is on this phone's record stays dead after a reload", ({ Given, When, Then, And }) => {
    Given('a question card with the options {string} and {string}, which he answered {string} a minute after it was asked', async (_c, _a: string, _b: string, answer: string) => {
      await db.answers.put({ bead: BEAD, answer, txid: 'direct:bb', ts: Math.floor((Date.now() - 4 * 60_000) / 1000) });
    });
    When('the card is shown', async () => {
      render(<NeedCard need={need(['Yes', 'No'], 5)} />);
    });
    Then('every option and {string} is disabled', async (_c, words: string) => {
      await waitFor(() => {
        const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeDisabled();
        expect(screen.getByRole('button', { name: words })).toBeDisabled();
      });
    });
    And('the card says {string} and the time as HH:MM', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toMatch(new RegExp(`${line} ${HH_MM.source}`)));
    });
  });
});
