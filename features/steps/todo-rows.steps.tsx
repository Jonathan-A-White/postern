// features/steps/todo-rows.steps.tsx — runs features/todo-rows.feature (mw-ht6gsw.5):
// the To do board's rows (Do now, Make time, Later, Let go) against a seeded Dexie view, no network.
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

const feature = await loadFeature('features/todo-rows.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });
  AfterEachScenario(thawClock);

  const aList = (list: string, rows: string, created = new Date(now).toISOString()) => {
    beads.push(beadIn(list, { type: 'epic', labels: ['hitl'], created }));
    rows.split(', ').forEach((row, at) => {
      beads.push(beadIn(`${list}.${at + 1}`, { parent: list, labels: ['hitl', 'hitl:todo'], created: new Date(now - (10 - at) * 3_600_000).toISOString(), ...(row !== 'none' ? { todo_row: row as never } : {}) }));
    });
  };
  const withRows = (_c: unknown, list: string, rows: string) => aList(list, rows);
  const secondWithRows = (_c: unknown, list: string, rows: string) => aList(list, rows, new Date(now - 86_400_000).toISOString());
  const edit = (id: string, extra: Partial<ViewBead>) => {
    beads = beads.map((b) => (b.id === id ? { ...b, ...extra } : b));
  };
  const tabOpens = async () => {
    await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
  };
  const reopen = async () => {
    cleanup();
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
    await screen.findByRole('region', { name: 'Do now' });
  };
  const rowOf = async (name: string) => screen.findByRole('region', { name });
  const listNamed = async (name: string) => screen.findByRole('region', { name });
  const foldButton = async (name: string, open: boolean) => screen.findByRole('button', { name: `${open ? 'Fold' : 'Open'} ${name}` });
  const outboxActions = async () => (await db.outbox.toArray()).map((row) => row.payload.action);
  const cardIn = async (name: string) => (await screen.findByText(name)).closest('[data-testid="todo-card"]') as HTMLElement;
  const dueIn = (days: number) => new Date(now + days * 86_400_000).toISOString();

  Scenario('mw-ht6gsw.5 AC-1: cards in the rows now, now, make-time, later, later and let-go show Do now, Make time, and Later and Let go folded with their counts', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('a second list {string} whose cards are in the rows {string}', secondWithRows);
    When('the To do tab opens as he first finds it', tabOpens);
    Then('the row {string} shows {string} then {string}', async (_c, row: string, one: string, two: string) => {
      const el = await rowOf(row);
      await waitFor(() => expect(namesIn(el)).toEqual([one, two]));
    });
    And('the row {string} shows only {string}', async (_c, row: string, one: string) => {
      const el = await rowOf(row);
      await waitFor(() => expect(namesIn(el)).toEqual([one]));
    });
    And('{string} is folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    And('{string} is also folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    And('no card of the rows {string} or {string} is shown', async () => {
      const shown = screen.getAllByTestId('todo-card').length;
      const inRows = namesIn(await rowOf('Do now')).length + namesIn(await rowOf('Make time')).length;
      expect(shown).toBe(inRows);
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: opening Later shows the two list columns with their Later cards, and folding it hides them', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('a second list {string} whose cards are in the rows {string}', secondWithRows);
    When('the To do tab opens as he first finds it', tabOpens);
    And('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    Then('the board has the columns {string} and {string}', async (_c, one: string, two: string) => {
      expect(await listNamed(one)).toBeInTheDocument();
      expect(await listNamed(two)).toBeInTheDocument();
    });
    And('the list {string} shows only {string}', async (_c, list: string, one: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one]));
    });
    And('the list {string} likewise shows only {string}', async (_c, list: string, one: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one]));
    });
    When('he folds {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, true));
    });
    Then('{string} is folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    And('no card of the rows {string} or {string} is shown', async () => {
      const shown = screen.getAllByTestId('todo-card').length;
      const inRows = namesIn(await rowOf('Do now')).length + namesIn(await rowOf('Make time')).length;
      expect(shown).toBe(inRows);
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: opening Let go shows its card with Keep and Drop', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('a second list {string} whose cards are in the rows {string}', secondWithRows);
    When('the To do tab opens as he first finds it', tabOpens);
    And('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    Then('the card {string} in Let go offers Keep and Drop', async (_c, name: string) => {
      const el = await cardIn(name);
      expect(within(await rowOf('Let go')).getByText(name)).toBeInTheDocument();
      expect(within(el).getByRole('button', { name: `Keep: ${name}` })).toHaveTextContent('Keep');
      expect(within(el).getByRole('button', { name: `Drop: ${name}` })).toHaveTextContent('Drop');
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: Keep sends a todo_edit with row later and the card moves to Later at once', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('a second list {string} whose cards are in the rows {string}', secondWithRows);
    When('the To do tab opens as he first finds it', tabOpens);
    And('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    And('he taps Keep on {string}', async (_c, name: string) => {
      await userEvent.click(within(await cardIn(name)).getByRole('button', { name: `Keep: ${name}` }));
    });
    Then('a todo_edit for {string} with row {string} and nothing else waits in the outbox', async (_c, bead: string, row: string) => {
      await waitFor(async () => expect(await outboxActions()).toEqual([{ action: 'todo_edit', bead, row }]));
    });
    And('{string} is folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    And('no Let go row is shown', () => {
      expect(screen.queryByRole('button', { name: /Let go/ })).toBeNull();
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: Drop sends a close with the reason let-go and says it waits for the Mayor', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('a second list {string} whose cards are in the rows {string}', secondWithRows);
    When('the To do tab opens as he first finds it', tabOpens);
    And('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    And('he taps Drop on {string}', async (_c, name: string) => {
      await userEvent.click(within(await cardIn(name)).getByRole('button', { name: `Drop: ${name}` }));
    });
    Then('a close for {string} with the reason {string} waits in the outbox', async (_c, bead: string, reason: string) => {
      await waitFor(async () => expect(await outboxActions()).toEqual([{ action: 'close', bead, reason }]));
    });
    And('the card {string} in Let go says {string} and offers neither Keep nor Drop', async (_c, name: string, words: string) => {
      const el = await cardIn(name);
      await waitFor(() => expect(within(el).getByRole('status')).toHaveTextContent(words));
      expect(within(el).queryByRole('button', { name: /^(Keep|Drop)/ })).toBeNull();
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: a card with no todo_row is under Later', ({ Given, When, Then, And }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    When('the To do tab opens as he first finds it', tabOpens);
    Then('{string} is folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    And('the row {string} says {string}', async (_c, row: string, words: string) => {
      const el = await rowOf(row);
      expect(el).toHaveTextContent(words);
      expect(within(el).queryAllByTestId('todo-card')).toHaveLength(0);
    });
    And('the row {string} also says {string}', async (_c, row: string, words: string) => {
      const el = await rowOf(row);
      expect(el).toHaveTextContent(words);
      expect(within(el).queryAllByTestId('todo-card')).toHaveLength(0);
    });
    When('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    Then('the list {string} shows only {string} then {string}', async (_c, list: string, one: string, two: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one, two]));
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: a fourth now card goes to Later, the three due soonest staying in Do now', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('the card {string} is due tomorrow', (_c, id: string) => edit(id, { todo_due: dueIn(1) }));
    And('the card {string} is due in 2 days', (_c, id: string) => edit(id, { todo_due: dueIn(2) }));
    And('the card {string} is due in 3 days', (_c, id: string) => edit(id, { todo_due: dueIn(3) }));
    And('the card {string} is due in 4 days', (_c, id: string) => edit(id, { todo_due: dueIn(4) }));
    When('the To do tab opens as he first finds it', tabOpens);
    Then('the row {string} shows {string} then {string} then {string}', async (_c, row: string, one: string, two: string, three: string) => {
      const el = await rowOf(row);
      await waitFor(() => expect(namesIn(el)).toEqual([one, two, three]));
    });
    And('{string} is folded', async (_c, name: string) => {
      expect(await foldButton(name, false)).toHaveAttribute('aria-expanded', 'false');
    });
    When('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    Then('the list {string} shows only {string}', async (_c, list: string, one: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one]));
    });
  });

  Scenario("mw-ht6gsw.5 AC-2: a card's back shows the pass's why under its title", ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('the card {string} has the why {string}', (_c, id: string, why: string) => edit(id, { todo_row_why: why }));
    When('the To do tab opens as he first finds it', tabOpens);
    And('he turns {string} over', async (_c, name: string) => {
      await userEvent.click(within(await cardIn(name)).getByRole('button', { name }));
    });
    Then('the back of {string} shows the why {string}', async (_c, name: string, why: string) => {
      const back = await screen.findByRole('group', { name: `Back of ${name}` });
      expect(within(back).getByTestId('row-why')).toHaveTextContent(why);
      const kids = Array.from(back.querySelectorAll('p'));
      const titleAt = kids.findIndex((p) => p.textContent?.startsWith(name));
      expect(kids.findIndex((p) => p.dataset.testid === 'row-why')).toBe(titleAt + 1);
    });
  });

  Scenario('mw-ht6gsw.5 AC-1: a card in Do now names its list, and shows its star, due time and size', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    And('the card {string} is due tomorrow', (_c, id: string) => edit(id, { todo_due: dueIn(1) }));
    And('the card {string} is important', (_c, id: string) => edit(id, { todo_important: true }));
    And('the card {string} is of size {string}', (_c, id: string, size: string) => edit(id, { todo_size: size as never }));
    When('the To do tab opens as he first finds it', tabOpens);
    Then('the card {string} in Do now names its list {string}, is starred, shows a due time and the size mark {string}', async (_c, name: string, list: string, mark: string) => {
      const el = await cardIn(name);
      expect(within(await rowOf('Do now')).getByText(name)).toBeInTheDocument();
      expect(within(el).getByTestId('card-list')).toHaveTextContent(list);
      expect(within(el).getByRole('button', { name: `Clear important: ${name}` })).toBeInTheDocument();
      expect(within(el).getByTestId('due')).toBeInTheDocument();
      expect(within(el).getByTestId('size-mark')).toHaveTextContent(mark);
    });
  });

  Scenario('mw-ht6gsw.5 AC-3: the Today tap on a card in Later puts it first in its column for that day only', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} whose cards are in the rows {string}', withRows);
    When('the To do tab opens as he first finds it', tabOpens);
    And('he opens {string}', async (_c, name: string) => {
      await userEvent.click(await foldButton(name, false));
    });
    And('he turns {string} over', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    And("he taps {string} on the card's back", async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    And('he taps Back on the card', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    });
    Then('the list {string} shows only {string} then {string}', async (_c, list: string, one: string, two: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one, two]));
    });
    When('it is the next day and the To do tab is opened again', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now + 86_400_000));
      await reopen();
    });
    Then('the list {string} again shows only {string} then {string}', async (_c, list: string, one: string, two: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([one, two]));
    });
  });
});
