// features/steps/share-out.steps.tsx — runs features/share-out.feature (mw-gq6.252): Share on a
// message or card hands the phone's share sheet its readable text; where there is no share sheet
// it copies the text and says Copied. navigator.share and the clipboard are doubles.
import '@testing-library/react/dont-cleanup-after-each';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { LiveCard } from '../../src/cockpit/LiveCard';
import type { LiveCard as LiveCardData } from '../../src/model/cards';
import type { ConversationItem } from '../../src/model/conversation';

const MESSAGE: ConversationItem = {
  id: 'm1',
  txid: 'ab'.repeat(32),
  at: 1_760_000_000_000,
  speaker: 'mayor',
  speakerLabel: 'Mayor',
  kind: 'text',
  text: 'Bring **tea**:\n- green\n- black\n```\nkettle --on\n```',
  source: 'message',
};
const MESSAGE_PLAIN = 'Bring tea:\n- green\n- black\nkettle --on';

const QUESTION: ConversationItem = {
  id: 'q1',
  txid: 'cd'.repeat(32),
  at: 1_760_000_060_000,
  speaker: 'mayor',
  speakerLabel: 'Mayor',
  kind: 'question',
  text: 'Which way?',
  question: { bead: 'mw-x.1', q: 'Which way?', rec: 'A: Left', options: ['A: Left', 'B: Right'] },
  source: 'message',
};

const CARD: LiveCardData = {
  id: 'c1',
  title: 'Friday jobs',
  sentAt: 0,
  items: [
    { n: 1, text: 'Pay the rent', links: [], done: false, since: 0 },
    { n: 2, text: 'Call Luke', links: [], done: false, since: 0 },
  ],
  subscribe: { kinds: [], beads: [] },
  done: false,
};

const share = vi.fn().mockResolvedValue(undefined);
const writeText = vi.fn().mockResolvedValue(undefined);

function messageAt(index: number): HTMLElement {
  return screen.getAllByTestId('message')[index];
}

afterAll(() => cleanup());

const feature = await loadFeature('features/share-out.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(() => {
    cleanup();
    share.mockClear();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  Scenario("AC-1: Share on a message opens the phone's share sheet with its readable text and the channel's name", ({ Given, And, When, Then }) => {
    Given('a conversation in the channel Factory with a message and a question card', () => {
      render(<Conversation items={[MESSAGE, QUESTION]} shareTitle="Postern: Factory" />);
    });
    And('the phone has a share sheet', () => {
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    });
    When('Share is tapped on the message', async () => {
      await userEvent.click(within(messageAt(0)).getByRole('button', { name: 'Share' }));
    });
    Then("the share sheet gets the message's words with the title Postern: Factory", () => {
      expect(share).toHaveBeenCalledWith({ title: 'Postern: Factory', text: MESSAGE_PLAIN });
    });
  });

  Scenario('AC-2: Share on a question card shares the question and each option as a line', ({ Given, And, When, Then }) => {
    Given('a conversation in the channel Factory with a message and a question card', () => {
      render(<Conversation items={[MESSAGE, QUESTION]} shareTitle="Postern: Factory" />);
    });
    And('the phone has a share sheet', () => {
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    });
    When('Share is tapped on the question card', async () => {
      await userEvent.click(within(messageAt(1)).getByRole('button', { name: 'Share' }));
    });
    Then('the share sheet gets the question and its options as lines', () => {
      expect(share).toHaveBeenCalledWith({ title: 'Postern: Factory', text: 'Which way?\nA: Left (recommended)\nB: Right' });
    });
  });

  Scenario('AC-3: Without a share sheet Share copies the text and says Copied', ({ Given, And, When, Then }) => {
    Given('a conversation in the channel Factory with a message and a question card', () => {
      render(<Conversation items={[MESSAGE, QUESTION]} shareTitle="Postern: Factory" />);
    });
    And('the phone has no share sheet', () => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    });
    When('Share is tapped on the message', async () => {
      await userEvent.click(within(messageAt(0)).getByRole('button', { name: 'Share' }));
    });
    Then("the clipboard holds the message's words", () => {
      expect(writeText).toHaveBeenCalledWith(MESSAGE_PLAIN);
    });
    And('the button says Copied', async () => {
      await waitFor(() => expect(within(messageAt(0)).getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    });
  });

  Scenario('AC-4: Share on a live card shares its title and numbered items', ({ Given, And, When, Then }) => {
    Given('a live card with two items', () => {
      render(<LiveCard card={CARD} shareTitle="Postern: Factory" />);
    });
    And('the phone has a share sheet', () => {
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    });
    When('Share is tapped on the card', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    Then('the share sheet gets the card as lines', () => {
      expect(share).toHaveBeenCalledWith({ title: 'Postern: Factory', text: 'Friday jobs\n1. Pay the rent\n2. Call Luke' });
    });
  });
});
