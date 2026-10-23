// features/steps/answer-names-card.steps.tsx — runs features/answer-names-card.feature (mw-1cfk7g.1):
// the answer a card sends names that card (the reply record's `re`), and only that card reads answered.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Conversation } from '../../src/cockpit/Conversation';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import type { ConversationItem } from '../../src/model/conversation';
import type { MessageRow } from '../../src/data/db';
import { encodeQuestion } from '../../src/services/questions';

const sendAnswer = vi.fn<(bead: string, answer: string, re?: string) => Promise<{ id: number }>>();
vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendAnswer: (bead: string, answer: string, re?: string) => sendAnswer(bead, answer, re),
}));

const BEAD = 'mw-6ww.119';
const FIRST = `direct:${'a'.repeat(64)}`;
const SECOND = `direct:${'b'.repeat(64)}`;

let items: ConversationItem[] = [];

function asked(id: string, txid: string, options: string[], minutesAgo: number): ConversationItem {
  return {
    id,
    txid,
    at: Date.now() - minutesAgo * 60_000,
    speaker: 'mayor',
    speakerLabel: 'Mayor',
    kind: 'question',
    text: 'Which?',
    question: { bead: BEAD, q: 'Which?', rec: '', options },
    source: 'message',
  };
}

function questionRow(txid: string, options: string[], minutesAgo: number): MessageRow {
  const ts = Math.floor((Date.now() - minutesAgo * 60_000) / 1000);
  return { id: `${txid}:0`, txid, vout: 0, seq: ts, class: 'decision-needed', to: 't', from: 'f', ts, ciphertext: '', plaintext: encodeQuestion({ bead: BEAD, q: 'Which?', rec: '', options }), direction: 'received', read: true, thread: `bead:${BEAD}` };
}

async function answerComment(words: string, txid: string) {
  const now = Date.now();
  const detail = { v: 2, id: BEAD, title: 'Digest', type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [{ at: new Date(now - 60_000).toISOString(), author: 'mw@laptop', text: `ANSWER ${new Date(now - 60_000).toISOString()} from 02ab, txid ${txid}: ${words}` }] };
  await db.beadDetails.put({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: now });
}

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/answer-names-card.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    cleanup();
    forgetTaps();
    sendAnswer.mockReset();
    sendAnswer.mockResolvedValue({ id: 1 });
    await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
    window.history.replaceState(null, '', '/');
  });

  const twoCards = (Given: (text: string, fn: (_c: unknown, ...args: string[]) => Promise<void>) => void) =>
    Given('two question cards on one bead, the first with {string} and {string}, the second with {string} and {string}', async (_c, a: string, b: string, c: string, d: string) => {
      items = [asked('q1', FIRST, [a, b], 120), asked('q2', SECOND, [c, d], 60)];
    });

  Scenario("mw-1cfk7g.1: a tap on the first of two cards on a bead sends that card's id and marks only that card", ({ Given, When, Then, And }) => {
    twoCards(Given as never);
    When('he taps {string} on the first card', async (_c, option: string) => {
      render(<Conversation items={items} />);
      await userEvent.click(within(screen.getAllByTestId('message')[0]).getByRole('button', { name: option }));
    });
    Then('the answer sent names the first card', async () => {
      await waitFor(() => expect(sendAnswer).toHaveBeenCalledTimes(1));
      expect(sendAnswer).toHaveBeenCalledWith(BEAD, 'Weekly', FIRST);
    });
    And('the first card says {string} and the second card offers {string} and {string}', async (_c, line: string, a: string, b: string) => {
      await waitFor(() => expect(screen.getAllByTestId('message')[0].textContent).toContain(line));
      const second = screen.getAllByTestId('message')[1];
      expect(within(second).getByRole('button', { name: a })).toBeEnabled();
      expect(within(second).getByRole('button', { name: b })).toBeEnabled();
      expect(second.textContent).not.toContain('Answered');
    });
  });

  Scenario('mw-1cfk7g.1: a needs card for the second question stays open when the record names the first card', ({ Given, And, When, Then }) => {
    Given('a needs card for the second of two question cards on one bead', async () => {
      await db.messages.bulkPut([questionRow(FIRST, ['Weekly', 'Per demo'], 120), questionRow(SECOND, ['Rebase', 'Merge'], 60)]);
    });
    And("this phone's record of his answer {string} names the first card", async (_c, answer: string) => {
      await db.answers.put({ bead: BEAD, answer, txid: 'direct:cc', ts: Math.floor(Date.now() / 1000), re: FIRST });
    });
    When('the needs card is shown', async () => {
      render(<NeedCard need={{ kind: 'question', bead: BEAD, epic: '', title: 'Digest', since: new Date(Date.now() - 60 * 60_000).toISOString(), text: 'Which?', recommended: '', options: ['Rebase', 'Merge'], blocks: 0, steps: [] }} />);
    });
    Then('every option on the needs card is enabled and it does not say {string}', async (_c, word: string) => {
      // Nothing on screen proves the live reads have settled when the card stays open: give them a moment, then look.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await waitFor(() => {
        const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeEnabled();
        expect(screen.getByTestId('need-card').textContent).not.toContain(word);
      });
    });
  });

  Scenario('mw-1cfk7g.1: after a reload an answer record naming the first card leaves the second card open', ({ Given, When, Then, And }) => {
    twoCards(Given as never);
    And('this phone\'s record of his answer {string} names the first card', async (_c, answer: string) => {
      await db.answers.put({ bead: BEAD, answer, txid: 'direct:cc', ts: Math.floor(Date.now() / 1000), re: FIRST });
    });
    When('the conversation is shown', async () => {
      render(<Conversation items={items} />);
    });
    Then('the first card says {string} and the second card offers {string} and {string}', async (_c, line: string, a: string, b: string) => {
      await waitFor(() => expect(screen.getAllByTestId('message')[0].textContent).toContain(line));
      const second = screen.getAllByTestId('message')[1];
      expect(within(second).getByRole('button', { name: a })).toBeEnabled();
      expect(within(second).getByRole('button', { name: b })).toBeEnabled();
      expect(second.textContent).not.toContain('Answered');
    });
  });

  Scenario("mw-gq6.733: the factory's ANSWER comment for the first card's answer does not mark the second card", ({ Given, When, Then, And }) => {
    twoCards(Given as never);
    And('this phone\'s record of his answer {string} names the first card', async (_c, answer: string) => {
      await db.answers.put({ bead: BEAD, answer, txid: 'direct:cc', ts: Math.floor(Date.now() / 1000) - 120, re: FIRST });
    });
    And("the factory's ANSWER comment on the bead repeats {string} with that answer's id", async (_c, words: string) => {
      await answerComment(words, 'direct:cc');
    });
    When('the conversation is shown', async () => {
      render(<Conversation items={items} />);
    });
    Then('the first card says {string} and the second card offers {string} and {string}', async (_c, line: string, a: string, b: string) => {
      await waitFor(() => expect(screen.getAllByTestId('message')[0].textContent).toContain(line));
      // The comment is read a beat after the card shows: give it a moment, then look.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const second = screen.getAllByTestId('message')[1];
      expect(within(second).getByRole('button', { name: a })).toBeEnabled();
      expect(within(second).getByRole('button', { name: b })).toBeEnabled();
      expect(second.textContent).not.toContain('Answered');
    });
  });

  Scenario("mw-gq6.733: the factory's ANSWER comment for the first card's answer does not mark the second card's needs card", ({ Given, And, When, Then }) => {
    Given('a needs card for the second of two question cards on one bead', async () => {
      await db.messages.bulkPut([questionRow(FIRST, ['Weekly', 'Per demo'], 120), questionRow(SECOND, ['Rebase', 'Merge'], 60)]);
    });
    And('this phone\'s record of his answer {string} names the first card', async (_c, answer: string) => {
      await db.answers.put({ bead: BEAD, answer, txid: 'direct:cc', ts: Math.floor(Date.now() / 1000) - 120, re: FIRST });
    });
    And("the factory's ANSWER comment on the bead repeats {string} with that answer's id", async (_c, words: string) => {
      await answerComment(words, 'direct:cc');
    });
    When('the needs card is shown', async () => {
      render(<NeedCard need={{ kind: 'question', bead: BEAD, epic: '', title: 'Digest', since: new Date(Date.now() - 60 * 60_000).toISOString(), text: 'Which?', recommended: '', options: ['Rebase', 'Merge'], blocks: 0, steps: [] }} />);
    });
    Then('every option on the needs card is enabled and it does not say {string}', async (_c, word: string) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await waitFor(() => {
        const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeEnabled();
        expect(screen.getByTestId('need-card').textContent).not.toContain(word);
      });
    });
  });

  Scenario('mw-gq6.733: an ANSWER comment whose answer names no card still marks the card it was written after', ({ Given, When, Then, And }) => {
    twoCards(Given as never);
    And("the factory's ANSWER comment on the bead says {string} and its answer names no card", async (_c, words: string) => {
      await answerComment(words, 'direct:dd');
    });
    When('the conversation is shown', async () => {
      render(<Conversation items={items} />);
    });
    Then('the second card says {string}', async (_c, line: string) => {
      await waitFor(() => expect(screen.getAllByTestId('message')[1].textContent).toContain(line));
    });
  });
});
