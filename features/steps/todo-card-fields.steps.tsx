// features/steps/todo-card-fields.steps.tsx — runs features/todo-card-fields.feature (mw-ht6gsw.4):
// a card's size and Then line, on its front and its back, against a seeded Dexie view, no network.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Shell } from '../../src/cockpit/Shell';
import { TodoScreen } from '../../src/cockpit/TodoScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
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
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  localStorage.clear();
  window.history.replaceState(null, '', '/?v=todo');
}

const card = async (name: string) => (await screen.findByText(name)).closest('[data-testid="todo-card"]') as HTMLElement;
const back = async (name: string) => screen.findByRole('group', { name: `Back of ${name}` });
const sizeButton = async (name: string, label: string) => within(await back(name)).findByRole('button', { name: label });
const thenInput = async (name: string) => within(await back(name)).findByRole<HTMLInputElement>('textbox', { name: 'Then' });

afterAll(() => {
  vi.restoreAllMocks();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/todo-card-fields.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });

  const outboxActions = async () => (await db.outbox.toArray()).map((row) => row.payload.action);
  const waits = (expected: object) => async () => {
    await waitFor(async () => expect(await outboxActions()).toEqual([expected]));
  };
  /** A list with two open cards, the first (the given one) of the given size. */
  const aCardOfSize = (_c: unknown, id: string, size: string) => {
    const list = id.split('.')[0];
    beads.push(
      beadIn(list, { type: 'epic', labels: ['hitl'] }),
      beadIn(`${list}.1`, { parent: list, labels: ['hitl', 'hitl:todo'], created: new Date(now - 7_200_000).toISOString(), ...(id === `${list}.1` ? { todo_size: size as never } : {}) }),
      beadIn(`${list}.2`, { parent: list, labels: ['hitl', 'hitl:todo'] }),
    );
  };
  const hasThen = (_c: unknown, id: string, line: string) => {
    beads = beads.map((b) => (b.id === id ? { ...b, todo_then: line } : b));
  };
  const tabOpens = async () => {
    await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
    localStorage.setItem('postern.todo.folds', JSON.stringify({ later: true }));
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
  };
  const turnsOver = async (_c: unknown, name: string) => {
    await userEvent.click(within(await card(name)).getByRole('button', { name: name }));
  };
  const turnsBack = async (_c: unknown, name: string) => {
    await userEvent.click(within(await back(name)).getByRole('button', { name: 'Back' }));
  };
  const showsMark = async (_c: unknown, name: string, mark: string) => {
    await waitFor(async () => expect(within(await card(name)).getByTestId('size-mark')).toHaveTextContent(new RegExp(`^${mark}$`)));
  };
  const showsNoMark = async (_c: unknown, name: string) => {
    const el = await card(name);
    await waitFor(() => expect(within(el).queryByTestId('size-mark')).toBeNull());
  };
  const marked = async (_c: unknown, label: string, name: string) => {
    await waitFor(async () => expect(await sizeButton(name, label)).toHaveAttribute('aria-pressed', 'true'));
  };
  const tapSize = async (_c: unknown, label: string) => {
    const open = await screen.findByRole('group', { name: /^Back of / });
    await userEvent.click(within(open).getByRole('button', { name: label }));
  };
  const saveThen = async () => {
    const open = await screen.findByRole('group', { name: /^Back of / });
    await userEvent.click(within(open).getByRole('button', { name: /^(Save|Clear) Then$/ }));
  };

  Scenario('mw-ht6gsw.4 AC-1: a card the view gives the size hour shows 1h on its front and an Hour marked on its back', ({ Given, When, Then, And }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    Then('the front of {string} shows the size mark {string}', showsMark);
    And('the front of {string} shows no size mark', showsNoMark);
    When('he turns {string} over', turnsOver);
    Then('the size {string} is marked on the back of {string}', marked);
    And('the sizes {string} and {string} are not marked', async (_c, one: string, two: string) => {
      const open = await screen.findByRole('group', { name: /^Back of / });
      for (const label of [one, two]) expect(within(open).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  Scenario('mw-ht6gsw.4 AC-1: a tap on Quick sends todo_edit with size quick and the card shows Q at once', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    And('he taps the size {string}', tapSize);
    Then('a todo_edit for {string} with size {string} and nothing else waits in the outbox', (_c, bead: string, size: string) => waits({ action: 'todo_edit', bead, size })());
    And('the size {string} is marked on the back of {string}', marked);
    When('he turns {string} back', turnsBack);
    Then('the front of {string} shows the size mark {string}', showsMark);
  });

  Scenario('mw-ht6gsw.4 AC-1: a tap on a card that has no size yet sets it, and a half day shows half', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    And('he taps the size {string}', tapSize);
    Then('a todo_edit for {string} with size {string} and nothing else waits in the outbox', (_c, bead: string, size: string) => waits({ action: 'todo_edit', bead, size })());
    When('he turns {string} back', turnsBack);
    Then('the front of {string} shows the size mark {string}', showsMark);
  });

  Scenario('mw-ht6gsw.4 AC-1: a tap on the marked size sends size empty and the mark goes', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    And('he taps the size {string}', tapSize);
    Then('a todo_edit for {string} with size {string} and nothing else waits in the outbox', (_c, bead: string, size: string) => waits({ action: 'todo_edit', bead, size })());
    And('no size is marked on the back of {string}', async (_c, name: string) => {
      await waitFor(async () => expect(within(await back(name)).queryAllByRole('button', { pressed: true })).toHaveLength(0));
    });
    When('he turns {string} back', turnsBack);
    Then('the front of {string} shows no size mark', showsNoMark);
  });

  Scenario('mw-ht6gsw.4 AC-1: a Then line typed and confirmed sends todo_edit with then and shows on the back', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    Then('the back of {string} has an empty follow-up line and a dead Save button', async (_c, name: string) => {
      expect(await thenInput(name)).toHaveValue('');
      expect(within(await back(name)).getByRole('button', { name: 'Save Then' })).toBeDisabled();
    });
    When('he types the Then line {string}', async (_c, line: string) => {
      const open = await screen.findByRole('group', { name: /^Back of / });
      await userEvent.type(within(open).getByRole('textbox', { name: 'Then' }), line);
    });
    And('he confirms the Then line', saveThen);
    Then('a todo_edit for {string} with then {string} and nothing else waits in the outbox', (_c, bead: string, line: string) => waits({ action: 'todo_edit', bead, then: line })());
    And('the follow-up line on the back of {string} reads {string}', async (_c, name: string, line: string) => {
      await waitFor(async () => expect(await thenInput(name)).toHaveValue(line));
    });
  });

  Scenario('mw-ht6gsw.4 AC-1: a Then line the view carries shows on the back and clearing it sends then empty', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    And('the card {string} has the Then line {string}', hasThen);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    Then('the follow-up line on the back of {string} reads {string}', async (_c, name: string, line: string) => {
      await waitFor(async () => expect(await thenInput(name)).toHaveValue(line));
    });
    When('he clears the Then line', async () => {
      const open = await screen.findByRole('group', { name: /^Back of / });
      await userEvent.clear(within(open).getByRole('textbox', { name: 'Then' }));
    });
    And('he confirms the Then line', saveThen);
    Then('a todo_edit for {string} with then {string} and nothing else waits in the outbox', (_c, bead: string, line: string) => waits({ action: 'todo_edit', bead, then: line })());
  });

  Scenario('mw-ht6gsw.4 AC-1: a Then line over 200 characters is kept whole, says it is too long and cannot be saved', ({ Given, When, And, Then }) => {
    Given('a view with a card {string} of size {string}', aCardOfSize);
    When('the To do tab opens', tabOpens);
    And('he turns {string} over', turnsOver);
    And('he pastes a follow-up line of {int} characters', async (_c, length: number) => {
      const open = await screen.findByRole('group', { name: /^Back of / });
      const field = within(open).getByRole('textbox', { name: 'Then' });
      await userEvent.click(field);
      await userEvent.paste('x'.repeat(length));
    });
    Then('the back of {string} says the line is too long and its Save button is dead', async (_c, name: string) => {
      await waitFor(async () => expect(within(await back(name)).getByRole('status')).toHaveTextContent(/201 of 200: the Then line is too long to send/));
      expect(within(await back(name)).getByRole('button', { name: 'Save Then' })).toBeDisabled();
    });
    And('the whole {int} characters are still in the field', async (_c, length: number) => {
      const open = await screen.findByRole('group', { name: /^Back of / });
      expect(within(open).getByRole<HTMLInputElement>('textbox', { name: 'Then' }).value).toHaveLength(length);
    });
  });
});
