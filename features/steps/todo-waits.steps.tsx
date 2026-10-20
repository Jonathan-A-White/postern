// features/steps/todo-waits.steps.tsx — runs features/todo-waits.feature (mw-bdxfn5):
// a To do card whose bead waits on an unfinished bead says 'Waits on: <title>', sits below the doable cards and offers no Done,
// against a seeded Dexie view, no network. A bead's title reads "Title of <id>".
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { thawClock } from '../../tests/support/freeze-clock';
import { Shell } from '../../src/cockpit/Shell';
import { TodoScreen } from '../../src/cockpit/TodoScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

let now = Date.now();
let beads: ViewBead[] = [];

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra };
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  forgetTaps();
  await settlePhone();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  localStorage.clear();
  window.history.replaceState(null, '', '/?v=todo');
}

const namesIn = (scope: HTMLElement) =>
  within(scope)
    .queryAllByTestId('todo-card')
    .map((el) => el.querySelector('button[title="Turn the card over"] span')?.textContent ?? el.textContent);

afterAll(() => {
  vi.restoreAllMocks();
  cleanup();
});

const feature = await loadFeature('features/todo-waits.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });
  AfterEachScenario(thawClock);

  // Both cards are in Do now; the first is the older, so it would lead the row but for its wait.
  const save = async () => {
    await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  };
  const aList = (firstWaits: string[]) => {
    beads.push(
      beadIn('mw-a', { type: 'epic', labels: ['hitl'] }),
      beadIn('mw-blk', { type: 'task', labels: [] }),
      beadIn('mw-a.1', { parent: 'mw-a', labels: ['hitl', 'hitl:todo'], todo_row: 'now', created: new Date(now - 10 * 3_600_000).toISOString(), waits: firstWaits }),
      beadIn('mw-a.2', { parent: 'mw-a', labels: ['hitl', 'hitl:todo'], todo_row: 'now', created: new Date(now - 9 * 3_600_000).toISOString() }),
    );
  };
  const waitingList = () => aList(['mw-blk']);
  const freeList = () => aList([]);
  const tabOpens = async () => {
    await save();
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
  };
  const rowOf = async (name: string) => screen.findByRole('region', { name });
  const cardIn = async (name: string) => (await screen.findByText(name)).closest('[data-testid="todo-card"]') as HTMLElement;
  const showsInOrder = async (_c: unknown, row: string, one: string, two: string) => {
    const el = await rowOf(row);
    await waitFor(() => expect(namesIn(el)).toEqual([one, two]));
  };
  const offersDone = async (_c: unknown, name: string) => {
    expect(await within(await cardIn(name)).findByRole('button', { name: `Done: ${name}` })).toBeInTheDocument();
  };
  const noLongerWaits = async (_c: unknown, name: string) => {
    expect(within(await cardIn(name)).queryByText(/Waits on:/)).toBeNull();
  };

  Scenario('mw-bdxfn5 AC-1: a card waiting on an unfinished story says Waits on, links it, sits below the doable card and offers no Done', ({ Given, When, Then, And }) => {
    Given('a list {string} whose first card {string} waits on the open story {string} and whose second card {string} waits on nothing', waitingList);
    When('the To do tab opens', tabOpens);
    Then('the row {string} shows {string} then {string}', showsInOrder);
    And('the card {string} says {string} and links {string} to {string}', async (_c, name: string, words: string, blocker: string, id: string) => {
      const el = await cardIn(name);
      await waitFor(() => expect(within(el).getByText(words, { exact: false })).toBeInTheDocument());
      const link = within(el).getByRole('link', { name: blocker });
      expect(link.getAttribute('href')).toContain(id);
    });
    And('the card {string} offers no Done', async (_c, name: string) => {
      const el = await cardIn(name);
      expect(within(el).queryByRole('button', { name: `Done: ${name}` })).toBeNull();
    });
    And('the card {string} offers Done', offersDone);
  });

  Scenario('mw-bdxfn5 AC-1: the back of a waiting card offers no Done button either', ({ Given, When, Then, And }) => {
    Given('a list {string} whose first card {string} waits on the open story {string} and whose second card {string} waits on nothing', waitingList);
    When('the To do tab opens', tabOpens);
    And('he turns over {string}', async (_c, name: string) => {
      await userEvent.click(within(await cardIn(name)).getByTitle('Turn the card over'));
    });
    Then('the back of {string} has no Done button', async (_c, name: string) => {
      const back = await screen.findByRole('group', { name: `Back of ${name}` });
      expect(within(back.closest('[data-testid="todo-card"]') as HTMLElement).queryByRole('button', { name: /^Done/ })).toBeNull();
    });
  });

  Scenario('mw-bdxfn5 AC-2: when the wait finishes the card is a normal doable card again with no tap', ({ Given, When, Then, And }) => {
    Given('a list {string} whose first card {string} waits on the open story {string} and whose second card {string} waits on nothing', waitingList);
    When('the To do tab opens', tabOpens);
    And('the next view has the story {string} closed', async (_c, id: string) => {
      await screen.findByText('Waits on:', { exact: false });
      beads = beads.map((b) => (b.id === id ? { ...b, status: 'closed', closed: new Date(now).toISOString() } : b.id === 'mw-a.1' ? { ...b, waits: [] } : b));
      now += 1000;
      await save();
    });
    Then('the card {string} offers Done', offersDone);
    And('the card {string} no longer says {string}', noLongerWaits);
    And('the row {string} shows {string} then {string}', showsInOrder);
  });

  Scenario('mw-bdxfn5 AC-3: a card with no waits looks as it did, with its Done and no Waits on', ({ Given, When, Then, And }) => {
    Given('a list {string} whose first card {string} waits on nothing and whose second card {string} waits on nothing', freeList);
    When('the To do tab opens', tabOpens);
    Then('the row {string} shows {string} then {string}', showsInOrder);
    And('the card {string} offers Done', offersDone);
    And('the card {string} no longer says {string}', noLongerWaits);
  });
});
