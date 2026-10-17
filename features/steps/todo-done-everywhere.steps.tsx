// features/steps/todo-done-everywhere.steps.tsx — runs features/todo-done-everywhere.feature (mw-ev7oyy.42):
// an open hitl:todo bead shows Done on its page, its Needs you card and the To do board, whichever epic it hangs from,
// and a tap queues a close for it. The view is seeded in Dexie; a bead's title reads "Title of <id>".
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { TodoScreen } from '../../src/cockpit/TodoScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { Need, ViewBead } from '../../src/model/view';

let now = Date.now();
let beads: ViewBead[] = [];
let needs: Need[] = [];

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs, beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  needs = [];
  forgetTaps();
  await settlePhone();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  localStorage.clear();
  window.history.replaceState(null, '', '/');
}

const title = (id: string) => `Title of ${id}`;
const DONE_ON_PAGE = { name: 'Done' };

afterAll(() => {
  cleanup();
});

const feature = await loadFeature('features/todo-done-everywhere.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  // The epic carries no hitl:todo label: it is not one of his lists (the report: a nac step under such an epic).
  const aTodo = (_c: unknown, bead: string, epic: string) => {
    beads.push(beadIn(epic, { type: 'epic', labels: [] }), beadIn(bead, { parent: epic, labels: ['hitl', 'hitl:todo'] }));
  };
  const aPlain = (_c: unknown, bead: string, epic: string) => {
    beads.push(beadIn(epic, { type: 'epic', labels: [] }), beadIn(bead, { parent: epic, labels: [] }));
  };
  const aClosedChild = (_c: unknown, parent: string, child: string) => {
    beads.push(beadIn(child, { parent, status: 'closed', closed: new Date(now).toISOString(), labels: [] }));
  };
  const aStepCard = (_c: unknown, bead: string) => {
    const epic = beads.find((b) => b.id === bead)?.parent ?? '';
    needs.push({ kind: 'hands', bead, epic, title: title(bead), since: new Date(now - 60_000).toISOString(), text: 'Do it by hand.', recommended: '', options: [], blocks: 0, steps: [], waits_for: 'you', not_ready: false, waiting_on: [] });
  };
  const openPage = async (_c: unknown, bead: string) => {
    await save();
    render(<BeadScreen id={bead} />);
    await screen.findByLabelText('Actions');
    await screen.findByText('Priority');
  };
  const needsCard = async (bead: string) => (await screen.findByText(title(bead))).closest('article') as HTMLElement;

  Scenario('mw-ev7oyy.42 AC-1: a to do bead\'s own page offers Done', ({ Given, When, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    When('he opens the page of {string}', openPage);
    Then('the page offers a Done button', async () => {
      await waitFor(() => expect(screen.getByRole('button', DONE_ON_PAGE)).toBeEnabled());
    });
  });

  Scenario('mw-ev7oyy.42 AC-1: a to do bead with a child of its own still offers Done on its page', ({ Given, And, When, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    And('{string} has a closed child {string}', aClosedChild);
    When('he opens the page of {string}', openPage);
    Then('the page offers a Done button', async () => {
      await waitFor(() => expect(screen.getByRole('button', DONE_ON_PAGE)).toBeEnabled());
    });
  });

  Scenario('mw-ev7oyy.42 AC-1: a to do bead\'s card in Needs you offers Done', ({ Given, And, When, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    And('Needs you holds a step card for {string}', aStepCard);
    When('the Needs you tab opens', async () => {
      await save();
      render(<NeedsScreen />);
    });
    Then('the card of {string} offers a Done button', async (_c, bead: string) => {
      const card = await needsCard(bead);
      expect(within(card).getByRole('button', { name: 'Done' })).toBeEnabled();
    });
  });

  Scenario('mw-ev7oyy.42 AC-1: a to do bead\'s card on the To do board offers Done', ({ Given, When, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    When('the To do tab opens', async () => {
      await save();
      // Later starts folded; a card with no row is in Later
      localStorage.setItem('postern.todo.folds', JSON.stringify({ later: true }));
      render(<TodoScreen />);
    });
    Then('the board offers Done on {string}', async (_c, name: string) => {
      const card = (await screen.findByText(name)).closest('[data-testid="todo-card"]') as HTMLElement;
      expect(within(card).getByRole('button', { name: `Done: ${name}` })).toBeEnabled();
    });
  });

  Scenario('mw-ev7oyy.42 AC-2: Done on a to do bead under an epic that is not one of his lists closes it', ({ Given, When, And, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    When('he opens the page of {string}', openPage);
    And('he taps Done on the page', async () => {
      await userEvent.click(await screen.findByRole('button', DONE_ON_PAGE));
    });
    Then('a close action for {string} waits in the outbox', async (_c, bead: string) => {
      await waitFor(async () => expect(await db.outbox.toArray()).toMatchObject([{ kind: 'action', bead, payload: { action: { action: 'close', bead } } }]));
    });
    And('the page says Done is waiting for the Mayor and offers no Done button', async () => {
      await waitFor(() => expect(screen.queryByRole('button', DONE_ON_PAGE)).toBeNull());
      expect(screen.getByText(/waiting for the Mayor/i)).toBeInTheDocument();
    });
  });

  Scenario('mw-ev7oyy.42 AC-2: Done on the Needs you card of a to do bead closes it', ({ Given, And, When, Then }) => {
    Given('a to do bead {string} under the epic {string} that is not one of his lists', aTodo);
    And('Needs you holds a step card for {string}', aStepCard);
    When('the Needs you tab opens', async () => {
      await save();
      render(<NeedsScreen />);
    });
    And('he taps Done on the card of {string}', async (_c, bead: string) => {
      await userEvent.click(within(await needsCard(bead)).getByRole('button', { name: 'Done' }));
    });
    Then('a close action for {string} waits in the outbox', async (_c, bead: string) => {
      await waitFor(async () => expect(await db.outbox.toArray()).toMatchObject([{ kind: 'action', bead, payload: { action: { action: 'close', bead } } }]));
    });
  });

  Scenario('mw-ev7oyy.42 AC-1: a bead that is not a to do has no Done on its page', ({ Given, When, Then }) => {
    Given('a plain bead {string} under the epic {string} that is not one of his lists', aPlain);
    When('he opens the page of {string}', openPage);
    Then('the page has no Done button', async () => {
      expect(screen.queryByRole('button', DONE_ON_PAGE)).toBeNull();
    });
  });
});
