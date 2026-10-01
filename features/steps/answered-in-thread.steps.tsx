// features/steps/answered-in-thread.steps.tsx — runs features/answered-in-thread.feature (mw-gq6.214):
// a decision card drawn in a post's thread (Channels > Thread) goes dead on the same evidence Needs you
// uses (mw-gq6.199): his words naming an option, or the factory's ANSWER comment; a reply typed in the
// card's own thread appears there.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { encodeQuestion } from '../../src/services/questions';
import { encodeThreadedMessage } from '../../src/services/threads';
import { fixtureView } from '../../tests/support/cockpit-fixture';

configure({ asyncUtilTimeout: 5000 });

const BEAD = 'mw-q';
const THREAD = `bead:${BEAD}`;
const ASKED = Date.parse('2026-10-01T12:00:00Z');
let sequence = 0;
let questionTxid = '';

function row(plaintext: string, options: { cls?: string; direction: 'sent' | 'received'; thread?: string; atMs: number }): MessageRow {
  sequence += 1;
  const txid = `direct:${String(sequence).padStart(64, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: sequence,
    class: (options.cls ?? 'message') as MessageRow['class'],
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(options.atMs / 1000),
    ciphertext: '',
    plaintext,
    direction: options.direction,
    read: true,
    ...(options.thread ? { thread: options.thread } : {}),
  };
}

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  sequence = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear(), db.outbox.clear()]);
}

// A stand-in for App's routing: Talk on whatever thread and root the URL names.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return route.view === 'talk' ? <TalkScreen thread={route.thread} root={route.root} /> : null;
}

/** The question post in the bead's channel, the thread of it open. */
async function openThread(a: string, b: string): Promise<void> {
  cleanup();
  const asked = row(encodeQuestion({ bead: BEAD, q: 'Which way?', rec: a, options: [a, b] }), { cls: 'decision-needed', direction: 'received', thread: THREAD, atMs: ASKED });
  questionTxid = asked.txid;
  await messagesRepo.put(asked);
  const view = { ...fixtureView(ASKED), needs: [], beads: [] };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: new Date(ASKED).toISOString(), source: 'live', fetchedAt: ASKED });
  window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(THREAD)}&r=${encodeURIComponent(questionTxid)}`);
  render(<Harness />);
  await screen.findByText('Which way?');
}

const when = (relative: 'after' | 'before') => (relative === 'after' ? ASKED + 60_000 : ASKED - 60_000);

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/answered-in-thread.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const optionButtons = (options: string[]) => options.map((name) => screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  const everyOptionDisabled = async () => {
    await waitFor(() => {
      for (const button of optionButtons(['Do A', 'Do B'])) expect(button).toBeDisabled();
    });
  };
  const saysAnswered = async (_c: unknown, line: string) => {
    await waitFor(() => expect(within(screen.getByTestId('conversation')).getByRole('status').textContent).toMatch(new RegExp(`${line} \\d{2}:\\d{2}`)));
  };
  const stillLive = async () => {
    await screen.findByText('Which way?');
    // let any live query settle: the options must still be tappable and no Answered line shown
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const button of optionButtons(['Do A', 'Do B'])) expect(button).toBeEnabled();
    expect(screen.getByTestId('conversation').textContent).not.toContain('Answered');
  };
  const given = async (_c: unknown, a: string, b: string) => {
    await openThread(a, b);
  };
  const typedInChannel = (relative: 'after' | 'before') => async (_c: unknown, text: string) => {
    await messagesRepo.put(row(encodeThreadedMessage({ thread: { bead: BEAD }, text }), { direction: 'sent', thread: THREAD, atMs: when(relative) }));
  };
  const typedInReplies = async (_c: unknown, text: string) => {
    await userEvent.type(await screen.findByPlaceholderText('Reply…'), text);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
  };
  const threadShows = async (_c: unknown, text: string) => {
    await waitFor(() => {
      const shown = within(screen.getByTestId('conversation')).getAllByTestId('message');
      expect(shown).toHaveLength(2);
      expect(shown[0].textContent).toContain('Which way?');
      expect(shown[1].textContent).toContain(text);
    });
  };

  Scenario("mw-gq6.214: a reply typed in the bead's channel that names an option greys the card in its thread out", ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When("he typed {string} in that bead's channel after it was asked", typedInChannel('after'));
    Then('every option on the post is disabled', everyOptionDisabled);
    And('the post says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.214: a reply typed in Factory that names an option and the bead greys the card in its thread out', ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When('he typed {string} in Factory after it was asked', async (_c, text: string) => {
      await messagesRepo.put(row(text, { direction: 'sent', atMs: when('after') }));
    });
    Then('every option on the post is disabled', everyOptionDisabled);
    And('the post says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario("mw-gq6.214: words typed in Factory naming no bead leave the card live when the one open question is another bead's", ({ Given, And, When, Then }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    And('the only open question is on another bead', async () => {
      const need = { kind: 'question', bead: 'mw-other', epic: '', title: 'Other', since: new Date(ASKED).toISOString(), text: 'Which?', recommended: '', options: ['Do A', 'Do B'], blocks: 0, steps: [] };
      const view = { ...fixtureView(ASKED), needs: [need], beads: [] };
      await viewRepo.save({ plaintext: JSON.stringify(view), written_at: new Date(ASKED).toISOString(), source: 'live', fetchedAt: ASKED + 1 });
    });
    When('he typed {string} in Factory after it was asked', async (_c, text: string) => {
      await messagesRepo.put(row(text, { direction: 'sent', atMs: when('after') }));
    });
    Then('the options on the post are still live', stillLive);
  });

  Scenario('mw-gq6.214: an ANSWER comment on the bead greys the card in its thread out', ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When('the bead gets the comment {string} after it was asked', async (_c, text: string) => {
      const at = new Date(when('after')).toISOString();
      const detail = { v: 2, id: BEAD, title: `Paint ${BEAD}`, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], blocks: [], children: [], created: '', updated: '', started: '', closed: '', attempts: 0, description: '', acceptance: '', comments: [{ at, author: 'mw@laptop', text }] };
      await beadDetailsRepo.save({ id: BEAD, plaintext: JSON.stringify(detail), fetchedAt: ASKED });
    });
    Then('every option on the post is disabled', everyOptionDisabled);
    And('the post says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.214: an answer he tapped still greys the card in its thread out', ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When('he tapped {string} on that bead after it was asked', async (_c, option: string) => {
      await db.answers.put({ bead: BEAD, answer: option, txid: 'direct:'.padEnd(71, '0'), ts: Math.floor(when('after') / 1000) });
    });
    Then('every option on the post is disabled', everyOptionDisabled);
    And('the post says {string} and the time as HH:MM', saysAnswered);
  });

  Scenario('mw-gq6.214: words that name no option leave the card in its thread live', ({ Given, When, Then }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When("he typed {string} in that bead's channel after it was asked", typedInChannel('after'));
    Then('the options on the post are still live', stillLive);
  });

  Scenario('mw-gq6.214: words typed before the question was asked leave the card in its thread live', ({ Given, When, Then }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When("he typed {string} in that bead's channel before it was asked", typedInChannel('before'));
    Then('the options on the post are still live', stillLive);
  });

  Scenario('mw-gq6.214: a reply typed in a card\'s thread appears in that thread at once', ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When("he types {string} in the thread's Reply… composer and sends it", typedInReplies);
    Then('the thread shows the question and then {string}', threadShows);
    And('the options on the post are still live', stillLive);
  });

  Scenario("mw-gq6.214: a reply naming an option typed in a card's thread appears there and greys the card out", ({ Given, When, Then, And }) => {
    Given('a question post on a bead with the options {string} and {string}, open in its thread', given);
    When("he types {string} in the thread's Reply… composer and sends it", typedInReplies);
    Then('the thread shows the question and then {string}', threadShows);
    And('every option on the post is disabled', everyOptionDisabled);
    And('the post says {string} and the time as HH:MM', saysAnswered);
  });
});
