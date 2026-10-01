// features/steps/answered-in-words.steps.tsx — runs features/answered-in-words.feature (mw-gq6.199):
// a question card answered by words, whichever way they reached the factory (a reply typed in the
// bead's thread or in Factory, or the ANSWER comment the factory wrote on the bead), goes dead like a tapped one.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db, type MessageRow } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo } from '../../src/data/repositories';
import { indexView } from '../../src/model/tree';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need, View } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-q';
const ASKED = Date.parse('2026-10-01T12:00:00Z');
let sequence = 0;
let view: View;

function question(bead: string, options: string[]): Need {
  return { kind: 'question', bead, epic: '', title: `Paint ${bead}`, since: new Date(ASKED).toISOString(), text: 'Which way?', recommended: '', options, blocks: 0, steps: [] };
}

function card(needs: Need[]) {
  view = { ...fixtureView(ASKED), needs, beads: [] };
  render(<NeedCard need={needs[0]} index={indexView(view)} />);
}

function typed(text: string, thread: string | undefined, atMs: number): MessageRow {
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(atMs / 1000),
    ciphertext: '',
    plaintext: thread ? JSON.stringify({ thread: { bead: thread.replace('bead:', '') }, text }) : text,
    direction: 'sent',
    read: true,
    ...(thread ? { thread } : {}),
  };
}

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
  window.history.replaceState(null, '', '/');
}

const when = (relative: 'after' | 'before') => (relative === 'after' ? ASKED + 60_000 : ASKED - 60_000);

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/answered-in-words.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const everyOptionDisabled = async (_c: unknown, words: string) => {
    await waitFor(() => {
      const group = screen.getByRole('group', { name: 'Answers' });
      const buttons = within(group).getAllByRole('button');
      expect(buttons).toHaveLength(2);
      for (const button of buttons) expect(button).toBeDisabled();
      expect(screen.getByRole('button', { name: words })).toBeDisabled();
    });
  };
  const saysAnswered = async (_c: unknown, line: string) => {
    await waitFor(() => expect(screen.getByTestId('need-card').textContent).toMatch(new RegExp(`${line} \\d{2}:\\d{2}`)));
  };
  const stillLive = async () => {
    await screen.findByRole('group', { name: 'Answers' });
    // let any live query settle, then the options must still be tappable and no Answered line shown
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const button of within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')) expect(button).toBeEnabled();
    expect(screen.getByTestId('need-card').textContent).not.toContain('Answered');
  };
  const oneCard = async (_c: unknown, a: string, b: string) => {
    card([question(BEAD, [a, b])]);
  };

  Scenario("mw-gq6.199: a reply typed in the bead's thread that names an option greys the card out", ({ Given, When, Then, And }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When("he typed {string} in that bead's thread after it was asked", async (_c, text: string) => {
      await messagesRepo.put(typed(text, `bead:${BEAD}`, when('after')));
    });
    Then('every option and {string} is disabled', everyOptionDisabled);
    And('the card says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.199: a reply typed in Factory that names an option and the bead greys the card out', ({ Given, When, Then, And }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When('he typed {string} in Factory after it was asked', async (_c, text: string) => {
      await messagesRepo.put(typed(text, undefined, when('after')));
    });
    Then('every option and {string} is disabled', everyOptionDisabled);
    And('the card says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.199: a reply typed in Factory naming no bead greys the only open question out', ({ Given, When, Then }) => {
    Given('the only open question card has the options {string} and {string}', oneCard);
    When('he typed {string} in Factory after it was asked', async (_c, text: string) => {
      await messagesRepo.put(typed(text, undefined, when('after')));
    });
    Then('every option and {string} is disabled', everyOptionDisabled);
  });

  Scenario('mw-gq6.199: a reply typed in Factory naming no bead leaves one of two open questions live', ({ Given, When, Then }) => {
    Given('two open question cards, one on mw-q with the options {string} and {string}', async (_c, a: string, b: string) => {
      card([question(BEAD, [a, b]), question('mw-other', [a, b])]);
    });
    When('he typed {string} in Factory after it was asked', async (_c, text: string) => {
      await messagesRepo.put(typed(text, undefined, when('after')));
    });
    Then('the options of the card on mw-q are still live', stillLive);
  });

  Scenario('mw-gq6.199: a reply typed before the question was asked does not grey the card out', ({ Given, When, Then }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When("he typed {string} in that bead's thread before it was asked", async (_c, text: string) => {
      await messagesRepo.put(typed(text, `bead:${BEAD}`, when('before')));
    });
    Then('the options of the card on mw-q are still live', stillLive);
  });

  Scenario('mw-gq6.199: words that name no option leave the card live', ({ Given, When, Then }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When("he typed {string} in that bead's thread after it was asked", async (_c, text: string) => {
      await messagesRepo.put(typed(text, `bead:${BEAD}`, when('after')));
    });
    Then('the options of the card on mw-q are still live', stillLive);
  });

  const comment = async (text: string, relative: 'after' | 'before') => {
    const at = new Date(relative === 'after' ? ASKED + 60_000 : ASKED - 60_000).toISOString();
    const detail = { v: 2, id: BEAD, title: `Paint ${BEAD}`, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [{ at, author: 'mw@laptop', text }] };
    await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: ASKED });
  };

  Scenario('mw-gq6.199: an ANSWER comment on the bead greys the card out', ({ Given, When, Then, And }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When('the bead gets the comment {string} after it was asked', async (_c, text: string) => {
      await comment(text, 'after');
    });
    Then('every option and {string} is disabled', everyOptionDisabled);
    And('the card says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.199: an ANSWER comment from before the question was asked leaves the card live', ({ Given, When, Then }) => {
    Given('a question card on a bead with the options {string} and {string}', oneCard);
    When('the bead gets the comment {string} before it was asked', async (_c, text: string) => {
      await comment(text, 'before');
    });
    Then('the options of the card on mw-q are still live', stillLive);
  });
});
