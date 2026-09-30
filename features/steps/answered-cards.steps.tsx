// features/steps/answered-cards.steps.tsx — runs features/answered-cards.feature (mw-tbx1n.10):
// a tapped question card goes dead at once and says what he answered; the bead's page drops
// a question he has answered; a later question on the same bead is headed by its own words.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { NeedCard } from '../../src/cockpit/NeedCard';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

vi.mock('../../src/cockpit/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/cockpit/send')>()),
  sendAnswer: vi.fn(async () => ({ txid: 'direct:aa', channel: 'direct' })),
}));

const BEAD = 'mw-q';
const TITLE = 'Paint the door';

function viewBead(id: string, title: string): ViewBead {
  return { id, title, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

function question(text: string, sinceMs: number, options = ['Yes', 'No']): Need {
  return { kind: 'question', bead: BEAD, epic: '', title: TITLE, since: new Date(sinceMs).toISOString(), text, recommended: '', options, blocks: 0, steps: [] };
}

async function saveView(needs: Need[]): Promise<void> {
  const now = Date.now();
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs, beads: [viewBead(BEAD, TITLE)] }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  forgetTaps();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.beadDetails.clear(), db.messages.clear()]);
  window.history.replaceState(null, '', `/?v=bead&id=${BEAD}`);
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/answered-cards.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const beadPage = async () => {
    render(<BeadScreen id={BEAD} />);
  };

  Scenario('mw-tbx1n.10: after one tap on an option the options are disabled and say what he answered', ({ Given, When, Then, And }) => {
    Given('a question card with the options {string} and {string}', async (_c, a: string, b: string) => {
      render(<NeedCard need={question('Shall we?', Date.now() - 60_000, [a, b])} />);
    });
    When('he taps {string}', async (_c, option: string) => {
      await userEvent.click(screen.getByRole('button', { name: option }));
    });
    Then('every option and {string} is disabled', async (_c, words: string) => {
      await waitFor(() => {
        const group = screen.getByRole('group', { name: 'Answers' });
        const buttons = within(group).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeDisabled();
        expect(screen.getByRole('button', { name: words })).toBeDisabled();
      });
    });
    And('the card says {string}', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toContain(line));
    });
  });

  Scenario("mw-tbx1n.10: the bead's page no longer offers an answered question", ({ Given, When, Then }) => {
    Given('a question on a bead that he answered a minute after it was asked', async () => {
      const asked = Date.now() - 3_600_000;
      await saveView([question('Shall we?', asked)]);
      await db.answers.put({ bead: BEAD, answer: 'Yes', txid: 'direct:bb', ts: Math.floor((asked + 60_000) / 1000) });
    });
    When("the bead's page opens", beadPage);
    Then('the page offers no answer to that question', async () => {
      await screen.findByText('Description');
      await waitFor(() => expect(screen.queryByTestId('need-card')).toBeNull());
      expect(screen.queryByRole('group', { name: 'Answers' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Answer in words' })).toBeNull();
    });
  });

  Scenario('mw-tbx1n.10: a second question on the same bead shows its own words', ({ Given, When, Then, And }) => {
    Given('a bead whose first question he answered, and which has asked a second one: {string}', async (_c, words: string) => {
      const first = Date.now() - 7_200_000;
      await db.answers.put({ bead: BEAD, answer: 'Yes', txid: 'direct:cc', ts: Math.floor((first + 60_000) / 1000) });
      await saveView([question(`${words}\n\nRed or blue, said the painter.`, Date.now() - 300_000, ['Red', 'Blue'])]);
    });
    When("the bead's page opens", beadPage);
    Then('the card\'s headline is {string} with {string} and the time', async (_c, words: string, asked: string) => {
      const card = await screen.findByTestId('need-card');
      const headline = within(card).getByRole('heading', { name: new RegExp(words) });
      expect(headline.textContent).toBe(words);
      expect(card.textContent).toContain(`${asked} 5 min ago`);
    });
    And("the bead's title is shown beneath it", async () => {
      const card = await screen.findByTestId('need-card');
      expect(within(card).getByRole('link', { name: TITLE })).toBeInTheDocument();
    });
    And('the card does not say he answered', async () => {
      const card = await screen.findByTestId('need-card');
      expect(card.textContent).not.toContain('You answered');
      expect(within(card).getByRole('button', { name: 'Red' })).toBeEnabled();
    });
  });
});
