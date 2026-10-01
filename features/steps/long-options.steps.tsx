// features/steps/long-options.steps.tsx — runs features/long-options.feature (mw-gq6.172):
// a decision card's long options are stacked full-width buttons whose words wrap, and
// nothing in the conversation is wider than the screen. jsdom does no layout, so the
// scrollWidth and clientHeight figures here are 0 and the proof of the layout is the
// classes; tests/e2e/long-options.spec.ts measures the same card in a real 360 px browser.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { sendAnswer } from '../../src/cockpit/send';
import type { ConversationItem } from '../../src/model/conversation';

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendAnswer: vi.fn(async () => ({ txid: 'direct:aa', channel: 'direct' })),
}));

const filler = ' and then the words keep going well past the edge of a phone screen so that the option has to wrap onto several lines'.repeat(2);
const LONG = ['A', 'B', 'C'].map((letter, i) => `${letter}: option number ${i + 1}${filler}`.slice(0, 200));

function questionItem(options: string[], rec: string): ConversationItem {
  return {
    id: 'q1',
    at: 1_760_000_000_000,
    speaker: 'mayor',
    speakerLabel: 'Mayor',
    kind: 'question',
    text: 'Which way, given everything above?',
    question: { bead: 'mw-x', q: 'Which way?', rec, options },
    source: 'message',
  };
}

function answerItem(options: string[]): ConversationItem {
  return { id: 'a1', at: 1_760_000_060_000, speaker: 'you', speakerLabel: 'You', kind: 'answer', text: options[1], answer: options[1], source: 'message' };
}

let items: ConversationItem[] = [];

function show(options: string[], rec: string): void {
  cleanup();
  vi.mocked(sendAnswer).mockClear();
  items = [questionItem(options, rec), answerItem(options)];
}

function optionButtons(): HTMLElement[] {
  return within(screen.getByTestId('conversation'))
    .getAllByRole('button')
    .filter((b) => LONG.some((o) => b.textContent?.includes(o.slice(3, 30))));
}

afterAll(() => cleanup());

const feature = await loadFeature('features/long-options.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-gq6.172: three long options are stacked full-width buttons whose words wrap', ({ Given, When, Then, And }) => {
    Given('a phone 360 px wide and a question with three options of about 200 characters each', () => {
      window.innerWidth = 360;
      show(LONG, LONG[1]);
    });
    When('the conversation is shown', () => {
      render(<Conversation items={items} />);
    });
    Then('the options are stacked one under the other', () => {
      const [first] = optionButtons();
      expect(optionButtons()).toHaveLength(3);
      expect(first.parentElement).toHaveClass('flex-col');
      expect(first.parentElement).not.toHaveClass('flex-row');
    });
    And('every option button is as wide as the card, wraps its words and grows taller than one line', () => {
      for (const button of optionButtons()) {
        expect(button).toHaveClass('w-full', 'min-w-0', 'whitespace-normal', 'text-left', 'break-words');
        // A one-line Button is h-8; a wrapping one has no fixed height to hold it to one line.
        expect(button.className).not.toMatch(/(^|\s)h-8(\s|$)/);
        expect(button).toHaveClass('h-auto');
      }
    });
    And('the letter and colon that start an option are bold', () => {
      const [first] = optionButtons();
      const strong = first.querySelector('strong');
      expect(strong?.textContent).toBe('A:');
    });
    And('the recommended option keeps its primary look and its "rec." mark', () => {
      const [first, second] = optionButtons();
      expect(second).toHaveClass('bg-accent');
      expect(within(second).getByText('rec.')).toBeInTheDocument();
      expect(first).not.toHaveClass('bg-accent');
      expect(within(first).queryByText('rec.')).toBeNull();
    });
  });

  Scenario('mw-gq6.172: nothing in the conversation is wider than the viewport', ({ Given, When, Then, And }) => {
    Given('a phone 360 px wide and a question with three options of about 200 characters each', () => {
      window.innerWidth = 360;
      show(LONG, LONG[1]);
    });
    When('the conversation is shown', () => {
      render(<Conversation items={items} />);
    });
    Then('the conversation list is no wider than its own box', () => {
      const list = screen.getByTestId('conversation');
      expect(list.scrollWidth).toBe(list.clientWidth);
    });
    And('the answer chip is allowed to shrink to the screen and not to run past it', () => {
      const chip = screen.getByText(/answered:/).closest('span.inline-flex');
      expect(chip).toHaveClass('max-w-full');
      expect(screen.getByText(/answered:/)).toHaveClass('min-w-0');
    });
  });

  Scenario('mw-gq6.172: short options stay in one row', ({ Given, When, Then }) => {
    Given('a question with the options "Yes" and "No"', () => {
      show(['Yes', 'No'], 'Yes');
    });
    When('the conversation is shown', () => {
      render(<Conversation items={[items[0]]} />);
    });
    Then('the options sit in a wrapping row, as before', () => {
      const yes = screen.getByText('Yes', { selector: 'button' });
      expect(yes.parentElement).toHaveClass('flex-wrap');
      expect(yes.parentElement).not.toHaveClass('flex-col');
    });
  });

  Scenario("mw-gq6.172: a tap on a long option still sends the whole option text", ({ Given, And, When, Then }) => {
    Given('a phone 360 px wide and a question with three options of about 200 characters each', () => {
      window.innerWidth = 360;
      show(LONG, LONG[0]);
    });
    And('the conversation is shown', () => {
      render(<Conversation items={[items[0]]} />);
    });
    When('he taps the second option', async () => {
      await userEvent.click(optionButtons()[1]);
    });
    Then("the answer sent is the second option's full text", () => {
      expect(sendAnswer).toHaveBeenCalledWith('mw-x', LONG[1]);
    });
  });
});
