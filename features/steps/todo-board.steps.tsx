// features/steps/todo-board.steps.tsx — runs features/todo-board.feature (mw-ev7oyy.4):
// the To do tab inside the Shell against a seeded Dexie view, no network. A bead's title reads
// "Title of <id>"; a tap on Done lands in the outbox as a close action.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure, act, fireEvent } from '@testing-library/react';
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
import type { BeadDetail, ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

let now = Date.now();
let beads: ViewBead[] = [];
let viewSeq: number | undefined;
const notes = new Map<string, string>();

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads, ...(viewSeq !== undefined ? { seq: viewSeq } : {}) }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  viewSeq = undefined;
  notes.clear();
  forgetTaps();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  window.history.replaceState(null, '', '/?v=todo');
}

const title = (id: string) => `Title of ${id}`;
const cardTitled = async (text: string) => (await screen.findByText(text)).closest('[data-testid="todo-card"]') as HTMLElement;
const card = async (id: string) => (await screen.findByText(title(id))).closest('[data-testid="todo-card"]') as HTMLElement;

/** A board laid out on a 300 px column per list and a 90 px card every 100 px: jsdom has no layout, and a drag asks where things lie. */
const COLUMN = 320;
function layOut(): void {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const column = this.closest('[data-list]') as HTMLElement | null;
    const columns = Array.from(document.querySelectorAll('[data-list]'));
    if (this.dataset.list !== undefined) return rect(columns.indexOf(this) * COLUMN, 0, 300, 600);
    if (this.dataset.card !== undefined && column) return rect(columns.indexOf(column) * COLUMN, 40 + Array.from(column.querySelectorAll('[data-card]')).indexOf(this) * 100, 300, 90);
    return rect(0, 0, 0, 0);
  });
}

/** A mouse drag from the middle of a card to a point, as the pointer events a browser sends. */
async function dragCard(name: string, to: { x: number; y: number }): Promise<void> {
  const from = (await card(name.replace('Title of ', ''))).getBoundingClientRect();
  const start = { clientX: from.left + 150, clientY: from.top + 45 };
  const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true };
  await act(async () => {
    fireEvent.pointerDown(await card(name.replace('Title of ', '')), { ...pointer, ...start });
  });
  await act(async () => {
    fireEvent.pointerMove(window, { ...pointer, clientX: start.clientX + 12, clientY: start.clientY + 12 });
  });
  await act(async () => {
    fireEvent.pointerMove(window, { ...pointer, clientX: to.x, clientY: to.y });
  });
  await act(async () => {
    fireEvent.pointerUp(window, { ...pointer, clientX: to.x, clientY: to.y });
  });
}

const namesIn = (column: HTMLElement) =>
  within(column)
    .getAllByTestId('todo-card')
    .map((el) => el.querySelector('button[title="Turn the card over"] span, p span')?.textContent ?? el.textContent);

afterAll(() => {
  vi.restoreAllMocks();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/todo-board.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });


  const secondList = (_c: unknown, list: string) => {
    const older = new Date(now - 86_400_000).toISOString();
    beads.push(beadIn(list, { type: 'epic', labels: ['hitl'], created: older }), beadIn(`${list}.1`, { parent: list, labels: ['hitl', 'hitl:todo'], created: older }));
  };
  const listNamed = async (name: string) => screen.findByRole('region', { name });
  const outboxActions = async () => (await db.outbox.toArray()).map((row) => row.payload.action);
  const waits = (expected: object) => async () => {
    await waitFor(async () => expect(await outboxActions()).toEqual([expected]));
  };
  const pendingIn = (el: HTMLElement) => within(el).queryByTestId('pending-mark');
  const ordered = async (_c: unknown, list: string, first: string, second: string) => {
    const column = await listNamed(list);
    await waitFor(() => expect(namesIn(column)).toEqual([first, second]));
    return column;
  };
  const queuedRow = async (action: object, extra: object) => {
    await db.outbox.add({ kind: 'action', bead: (action as { bead: string }).bead, payload: { action }, created: now - 200_000, attempts: 1, clientId: 'x', ...(extra as object) } as never);
  };

  const aList = (_c: unknown, list: string) => {
    beads.push(
      beadIn(list, { type: 'epic', labels: ['hitl'] }),
      beadIn(`${list}.1`, { parent: list, labels: ['hitl', 'hitl:todo'], created: new Date(now - 7_200_000).toISOString() }),
      beadIn(`${list}.2`, { parent: list, labels: ['hitl', 'hitl:todo'] }),
      beadIn(`${list}.3`, { parent: list, labels: ['hitl', 'hitl:todo'], status: 'closed', closed: new Date(now).toISOString() }),
      beadIn(`${list}.4`, { parent: list, labels: ['hitl'] }),
    );
  };
  const noTodos = () => {
    beads.push(beadIn('mw-factory', { type: 'epic' }), beadIn('mw-factory.1', { parent: 'mw-factory' }));
  };
  const hasNotes = (_c: unknown, id: string, text: string) => {
    notes.set(id, text);
  };
  const tabOpens = async () => {
    await save();
    for (const [id, description] of notes) {
      const bead = beads.find((b) => b.id === id) as ViewBead;
      const detail: BeadDetail = { v: 2, ...bead, blocks: [], children: [], description, acceptance: '', comments: [{ at: new Date(now).toISOString(), author: 'mayor', text: 'Waiting on you.' }] };
      await db.beadDetails.put({ id, plaintext: JSON.stringify(detail), fetchedAt: now });
    }
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
  };
  const tapDone = async (_c: unknown, name: string) => {
    const el = await card(name.replace('Title of ', ''));
    await userEvent.click(within(el).getByRole('button', { name: 'Done' }));
  };
  const countIs = async (_c: unknown, count: number) => {
    const nav = await screen.findByRole('navigation', { name: 'Places' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: /To do/ })).toHaveTextContent(String(count)));
  };

  Scenario('mw-ev7oyy.4 AC-2: To do shows each list as a column of its open cards and counts them on the tab', ({ Given, When, Then, And }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    Then('the board has a column titled {string} holding {string} and {string}', async (_c, list: string, one: string, two: string) => {
      const column = await screen.findByRole('region', { name: list });
      await waitFor(() => expect(within(column).getByText(one)).toBeInTheDocument());
      expect(within(column).getByText(two)).toBeInTheDocument();
      // oldest first within one priority: the card made an hour earlier leads
      const names = within(column)
        .getAllByTestId('todo-card')
        .map((el) => within(el).getByRole('button', { name: /^Title of/ }).textContent);
      expect(names).toEqual([one, two]);
    });
    And('no card named {string} or {string} is shown', (_c, a: string, b: string) => {
      expect(screen.queryByText(a)).toBeNull();
      expect(screen.queryByText(b)).toBeNull();
    });
    And('the To do tab shows the count {int}', countIs);
  });

  Scenario('mw-ev7oyy.4 AC-2: Done queues a close for that card and greys it until the view drops it', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he taps Done on {string}', tapDone);
    Then('a close action for {string} waits in the outbox', async (_c, bead: string) => {
      await waitFor(async () => expect(await db.outbox.toArray()).toMatchObject([{ kind: 'action', bead, payload: { action: { action: 'close', bead } } }]));
    });
    And('the card {string} says {string} and offers no Done button', async (_c, name: string, words: string) => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(within(el).getByText(words)).toBeInTheDocument());
      expect(within(el).queryByRole('button', { name: 'Done' })).toBeNull();
      expect(el.className).toMatch(/opacity-/);
    });
    And('the card {string} still offers Done', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(within(el).getByRole('button', { name: 'Done' })).toBeEnabled();
    });
    When('a newer view arrives without {string}', async (_c, id: string) => {
      beads = beads.filter((b) => b.id !== id);
      now += 5_000;
      await act(async () => save());
    });
    Then('no card named {string} is shown', async (_c, name: string) => {
      await waitFor(() => expect(screen.queryByText(name)).toBeNull());
    });
  });

  Scenario('mw-ev7oyy.4 AC-6: a tap on a card turns it over to its back, and Back turns it again', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    And('he taps the card {string}', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    Then('the back of the card shows the notes {string} and a link to the bead {string}', async (_c, words: string, id: string) => {
      const back = await screen.findByRole('group', { name: 'Back of Title of mw-list.1' });
      await waitFor(() => expect(within(back).getAllByText(new RegExp(words)).length).toBeGreaterThan(0));
      expect(within(back).getAllByRole('link', { name: id })[0]).toHaveAttribute('href', `?v=bead&id=${id}`);
      expect(within(back).getByText('Waiting on you.')).toBeInTheDocument();
    });
    When('he taps Back on the card', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    });
    Then('the board shows the front of {string} again', async (_c, name: string) => {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /^Back of/ })).toBeNull();
    });
  });

  Scenario('mw-ev7oyy.4: with nothing on any list the board says so', ({ Given, When, Then, And }) => {
    Given('a view with no to do cards', noTodos);
    When('the To do tab opens', tabOpens);
    Then('the board says {string}', async (_c, words: string) => {
      expect(await screen.findByText(words)).toBeInTheDocument();
    });
    And('the To do tab shows no count', async () => {
      const nav = await screen.findByRole('navigation', { name: 'Places' });
      expect(within(nav).getByRole('link', { name: /To do/ })).toHaveTextContent(/^To do$/);
    });
  });

  Scenario("mw-ev7oyy.7 AC-1: Add a card at a list's foot shows it at once, pending, and queues a todo_add", ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he adds the card {string} at the foot of the list {string}', async (_c, title: string, list: string) => {
      const column = await listNamed(list);
      await userEvent.click(within(column).getByRole('button', { name: 'Add a card' }));
      await userEvent.type(within(column).getByLabelText('Title of the new card'), title);
      await userEvent.click(within(column).getByRole('button', { name: 'Add' }));
    });
    Then('a todo_add for the list {string} titled {string} waits in the outbox', async (_c, list: string, title: string) => {
      await waitFor(async () => expect(await outboxActions()).toEqual([{ action: 'todo_add', list, title }]));
    });
    And('the list {string} ends with the pending card {string}', async (_c, list: string, title: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(within(column).getAllByTestId('todo-card').at(-1)).toHaveTextContent(title));
      expect(pendingIn(within(column).getAllByTestId('todo-card').at(-1) as HTMLElement)).not.toBeNull();
    });
  });

  Scenario("mw-ev7oyy.7 AC-1: Edit on a card's back saves its title, shown at once and pending, as a todo_edit", ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    And('he taps the card {string}', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    And('he taps Edit on the card, changes the title to {string} and saves', async (_c, title: string) => {
      const edit = await screen.findByRole('button', { name: 'Edit' });
      await waitFor(() => expect(edit).toBeEnabled());
      await userEvent.click(edit);
      const field = await screen.findByLabelText('Title');
      await userEvent.clear(field);
      await userEvent.type(field, title);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    Then('a todo_edit for {string} with the title {string} and no notes waits in the outbox', async (_c, bead: string, title: string) => {
      await waitFor(async () => expect(await outboxActions()).toEqual([{ action: 'todo_edit', bead, title }]));
    });
    And('the card {string} is pending', async (_c, title: string) => {
      const el = await cardTitled(title);
      await waitFor(() => expect(pendingIn(el)).not.toBeNull());
    });
  });

  Scenario('mw-ev7oyy.7 AC-1: Dragging a card above another reorders the list at once and queues a todo_move', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he drags the card {string} above the card {string}', async (_c, moved: string, above: string) => {
      await screen.findByText(moved);
      layOut();
      const target = (await card(above.replace('Title of ', ''))).getBoundingClientRect();
      await dragCard(moved, { x: target.left + 150, y: target.top + 5 });
    });
    Then('a todo_move for {string} before {string} waits in the outbox', (_c, bead: string, before: string) => waits({ action: 'todo_move', bead, before })());
    And('the list {string} shows {string} then {string}, the first pending', async (_c, list: string, first: string, second: string) => {
      const column = await ordered(_c, list, first, second);
      const [one, two] = within(column).getAllByTestId('todo-card');
      expect(pendingIn(one)).not.toBeNull();
      expect(pendingIn(two)).toBeNull();
    });
  });

  Scenario('mw-ev7oyy.7 AC-1: Dragging a card onto another list moves it there and names the list', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('a second list {string} holding one open card', secondList);
    When('the To do tab opens', tabOpens);
    And('he drags the card {string} onto the foot of the list {string}', async (_c, moved: string) => {
      await screen.findByText(moved);
      layOut();
      await dragCard(moved, { x: COLUMN + 150, y: 580 });
    });
    Then('a todo_move for {string} to the list {string} after {string} waits in the outbox', (_c, bead: string, list: string, after: string) => waits({ action: 'todo_move', bead, list, after })());
    And('the list {string} shows {string} then {string}', (_c, list: string, first: string, second: string) => void ordered(_c, list, first, second));
    And('the list {string} shows only {string}', async (_c, list: string, only: string) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual([only]));
    });
  });

  Scenario("mw-ev7oyy.7 AC-1: Move down on a card's back is the keyboard's way to reorder", ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he taps the card {string}', async (_c, name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
    });
    And('he taps Move down on the card', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Move down' }));
    });
    Then('a todo_move for {string} after {string} waits in the outbox', (_c, bead: string, after: string) => waits({ action: 'todo_move', bead, after })());
  });

  Scenario('mw-ev7oyy.7 AC-1: A change the Mayor never echoes is rolled back with a short note', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('a move of {string} before {string} that went three minutes ago and was never echoed', async (_c, bead: string, before: string) => {
      await queuedRow({ action: 'todo_move', bead, before }, { state: 'sent', txid: `direct:${'c'.repeat(64)}`, sentAt: now - 180_000 });
    });
    When('the To do tab opens', tabOpens);
    Then('the list {string} shows {string} then {string}, neither pending', async (_c, list: string, first: string, second: string) => {
      const column = await ordered(_c, list, first, second);
      for (const el of within(column).getAllByTestId('todo-card')) expect(pendingIn(el)).toBeNull();
    });
    And('a note says the move was not done', async () => {
      await waitFor(() => expect(screen.getByTestId('refused-note')).toHaveTextContent('Moving “Title of mw-list.2” was not done'));
    });
  });

  Scenario('mw-ev7oyy.7 AC-1: A change stays pending until the view has reached its echo', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('an edit of {string} to {string} that went and was echoed at seq 9, the view being at seq 5', async (_c, bead: string, title: string) => {
      viewSeq = 5;
      const txid = `direct:${'d'.repeat(64)}`;
      await queuedRow({ action: 'todo_edit', bead, title }, { state: 'acked', txid, sentAt: now - 1_000 });
      await db.events.put({ seq: 9, ts: '', kind: 'action_applied', bead, actor: 'mw', from: '', to: '', detail: txid, lane: 'normal' });
    });
    When('the To do tab opens', tabOpens);
    Then('the card {string} is pending', async (_c, title: string) => {
      const el = await cardTitled(title);
      await waitFor(() => expect(pendingIn(el)).not.toBeNull());
    });
    When('a newer view at seq 9 arrives with {string} titled {string}', async (_c, bead: string, title: string) => {
      beads = beads.map((b) => (b.id === bead ? { ...b, title } : b));
      viewSeq = 9;
      now += 5_000;
      await act(async () => save());
    });
    Then('the card {string} is not pending', async (_c, title: string) => {
      const el = await cardTitled(title);
      await waitFor(() => expect(pendingIn(el)).toBeNull());
    });
  });
});
