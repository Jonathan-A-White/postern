// features/steps/todo-board.steps.tsx — runs features/todo-board.feature (mw-ev7oyy.4):
// the To do tab inside the Shell against a seeded Dexie view, no network. A bead's title reads
// "Title of <id>"; a tap on Done lands in the outbox as a close action.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { thawClock } from '../../tests/support/freeze-clock';
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
/** The groups of every list are opened (Soon and Someday start folded) unless a scenario is about the folding (mw-ev7oyy.16). */
let groupsAsFound = false;

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
  groupsAsFound = false;
  notes.clear();
  forgetTaps();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  localStorage.clear();
  window.history.replaceState(null, '', '/?v=todo');
}

/** A card's round check, named for a screen reader 'Done: <title>' (mw-ev7oyy.14). */
const DONE = /^Done: /;
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

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });
  AfterEachScenario(thawClock);


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
    const full = text.replaceAll('\\n', '\n');
    notes.set(id, full);
    // the view carries the notes' first 280 runes as the bead's summary, the whole of them only in the bead's detail
    const bead = beads.find((b) => b.id === id);
    if (bead) bead.summary = [...full].slice(0, 280).join('');
  };
  const tabOpens = async () => {
    await save();
    if (!groupsAsFound && !localStorage.getItem('postern.todo.groups')) {
      const open = { today: true, soon: true, someday: true };
      localStorage.setItem('postern.todo.groups', JSON.stringify(Object.fromEntries([...beads.filter((b) => b.type === 'epic').map((b) => b.id), 'other'].map((id) => [id, open]))));
    }
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
    await userEvent.click(within(el).getByRole('button', { name: DONE }));
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
      expect(within(el).queryByRole('button', { name: DONE })).toBeNull();
      expect(el.className).toMatch(/opacity-/);
    });
    And('the card {string} still offers Done', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(within(el).getByRole('button', { name: DONE })).toBeEnabled();
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

  // mw-ev7oyy.9: the due time, in the phone's zone (the suite runs at TZ=UTC), counted from the test's own clock.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dayAt = (days: number, hour: number, minute: number) => {
    const at = new Date(now);
    at.setDate(at.getDate() + days);
    at.setHours(hour, minute, 0, 0);
    return at;
  };
  const inputValue = (at: Date) => `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const dueOf = (id: string, at: Date) => {
    beads = beads.map((b) => (b.id === id ? { ...b, todo_due: at.toISOString() } : b));
  };
  const dueTomorrowAt9 = (_c: unknown, id: string) => dueOf(id, dayAt(1, 9, 0));
  const fellDueYesterday = (_c: unknown, id: string) => dueOf(id, dayAt(-1, 18, 30));
  const dueLine = async (name: string) => within(await card(name.replace('Title of ', ''))).queryByTestId('due');
  const dueInDays = (_c: unknown, id: string, days: string) => dueOf(id, dayAt(Number(days), 9, 0));
  const saysDue = (overdue: boolean) => async (_c: unknown, name: string, words: string) => {
    await waitFor(async () => expect(await dueLine(name)).toHaveTextContent(words));
    expect(await dueLine(name)).toHaveAttribute('data-past', String(overdue));
  };
  const tapCard = async (_c: unknown, name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }));
  };
  const tapBack = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
  };
  const menuOf = async (list: string) => within(await listNamed(list)).getByRole('button', { name: 'List menu' });
  const order = async (list: string, expected: string[]) => {
    const column = await listNamed(list);
    await waitFor(() => expect(namesIn(column)).toEqual(expected));
  };
  const orderStep = async (_c: unknown, list: string, one: string, two: string, three: string) => order(list, [one, two, three]);
  const chooseSort = (item: string) => async (_c: unknown, list: string) => {
    await userEvent.click(await menuOf(list));
    await userEvent.click(await screen.findByRole('menuitem', { name: item }));
  };

  Scenario('mw-ev7oyy.15 AC-2: a card says in words when it is due or overdue, and is never red', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} is due tomorrow at 9:00', dueTomorrowAt9);
    And('the card {string} fell due yesterday at 18:30', fellDueYesterday);
    When('the To do tab opens', tabOpens);
    Then('the card {string} says {string} and is not overdue', saysDue(false));
    And('the card {string} says {string} and is overdue', saysDue(true));
    And("neither card's due line is red", async () => {
      for (const name of ['Title of mw-list.1', 'Title of mw-list.2']) expect(((await dueLine(name)) as HTMLElement).className).not.toMatch(/danger/);
    });
  });

  Scenario("mw-ev7oyy.9 AC-2: the Due field on a card's back sets the due time as a todo_edit, shown at once and pending", ({ Given, When, And, Then }) => {
    const picked = () => dayAt(1, 17, 0);
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he taps the card {string}', tapCard);
    Then('Set due is not offered until a time is picked', async () => {
      await screen.findByLabelText('Due');
      await waitFor(() => expect(screen.getByLabelText('Due')).toHaveValue(''));
      expect(screen.getByRole('button', { name: 'Set due' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Clear due' })).toBeNull();
    });
    When('he picks tomorrow at 17:00 as the due time and taps Set due', async () => {
      fireEvent.change(await screen.findByLabelText('Due'), { target: { value: inputValue(picked()) } });
      await userEvent.click(await screen.findByRole('button', { name: 'Set due' }));
    });
    Then('a todo_edit for {string} with that due time and nothing else waits in the outbox', (_c, bead: string) => waits({ action: 'todo_edit', bead, due: picked().toISOString() })());
    When('he taps Back on the card', tapBack);
    Then('the card {string} says {string} and is not overdue', saysDue(false));
    And('the card {string} is pending', async (_c, title: string) => {
      const el = await cardTitled(title);
      await waitFor(() => expect(pendingIn(el)).not.toBeNull());
    });
  });

  Scenario('mw-ev7oyy.9 AC-2: Clear due on the back sends an empty due and takes the time off the card', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} is due tomorrow at 9:00', dueTomorrowAt9);
    When('the To do tab opens', tabOpens);
    And('he taps the card {string}', tapCard);
    And('he taps Clear due on the card', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Clear due' }));
    });
    Then('a todo_edit for {string} with an empty due and nothing else waits in the outbox', (_c, bead: string) => waits({ action: 'todo_edit', bead, due: '' })());
    When('he taps Back on the card', tapBack);
    Then('the card {string} shows no due time', async (_c, name: string) => {
      await card(name.replace('Title of ', ''));
      expect(await dueLine(name)).toBeNull();
    });
  });

  Scenario("mw-ev7oyy.9 AC-1: a list's menu sorts its cards by due, the earliest first and the undated last, and puts the order back", ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} is due in 5 days at 9:00', (_c, id: string) => dueInDays(_c, id, '5'));
    And('the card {string} is due in 4 days at 9:00', (_c, id: string) => dueInDays(_c, id, '4'));
    And('a card {string} with no due time, made last', (_c, id: string) => {
      beads.push(beadIn(id, { parent: 'mw-list', labels: ['hitl', 'hitl:todo'], created: new Date(now).toISOString() }));
    });
    When('the To do tab opens', tabOpens);
    Then('the list {string} shows {string}, {string} then {string}', orderStep);
    When('he chooses Sort by due in the menu of the list {string}', chooseSort('Sort by due'));
    Then('the list {string} now reads {string}, {string} then {string}', orderStep);
    And('a card in the list {string} cannot be moved up or down while it is sorted by due', async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Title of mw-list.1' }));
      await screen.findByRole('button', { name: 'Move up' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
      await tapBack();
    });
    When('he chooses Sort by my order in the menu of the list {string}', chooseSort('Sort by my order'));
    Then('the list {string} is back to {string}, {string} then {string}', orderStep);
  });

  // mw-ev7oyy.15: the star, and the float.
  const starOf = async (name: string) => within(await card(name.replace('Title of ', ''))).findByRole('button', { name: new RegExp(`^(Mark important|Clear important): ${name}$`) });
  const starOffers = (label: string) => async (_c: unknown, name: string) => {
    await waitFor(async () => expect(await starOf(name)).toHaveAccessibleName(`${label}: ${name}`));
  };
  const tapStar = async (_c: unknown, name: string) => {
    await userEvent.click(await starOf(name));
  };
  const madeLast = (id: string, extra: Partial<ViewBead>) => beads.push(beadIn(id, { parent: 'mw-list', labels: ['hitl', 'hitl:todo'], created: new Date(now).toISOString(), ...extra }));

  Scenario('mw-ev7oyy.15 AC-1: the star on a card marks it important with one tap and a second tap clears it', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    When('the To do tab opens', tabOpens);
    And('he taps the star on {string}', tapStar);
    Then('a todo_edit for {string} marking it important and nothing else waits in the outbox', (_c, bead: string) => waits({ action: 'todo_edit', bead, important: true })());
    And('the star on {string} now offers to clear it', starOffers('Clear important'));
    And('the card {string} is pending', async (_c, title: string) => {
      const el = await cardTitled(title);
      await waitFor(() => expect(pendingIn(el)).not.toBeNull());
    });
    When('he taps the star on {string}', tapStar);
    Then('the outbox holds the todo_edit marking {string} important, then one clearing it', async (_c, bead: string) => {
      await waitFor(async () =>
        expect(await outboxActions()).toEqual([
          { action: 'todo_edit', bead, important: true },
          { action: 'todo_edit', bead, important: false },
        ]),
      );
    });
  });

  Scenario('mw-ev7oyy.15 AC-1: a card the view says is important shows its star filled, and it survives a reload', ({ Given, When, And, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('the card {string} is important in the view', (_c, id: string) => {
      beads = beads.map((b) => (b.id === id ? { ...b, todo_important: true } : b));
    });
    When('the To do tab opens', tabOpens);
    Then('the star on {string} offers to clear it', starOffers('Clear important'));
    And('the star on {string} offers to mark it important', starOffers('Mark important'));
  });

  Scenario('mw-ev7oyy.15 AC-3: a card due within 48 hours or overdue floats up, soonest first, then the important ones, then the rest', ({ Given, And, When, Then }) => {
    Given('a view with a list {string} holding two open cards, a closed card and a card that is not a to do', aList);
    And('a card {string} that is important, made last', (_c, id: string) => madeLast(id, { todo_important: true }));
    And('a card {string} due tomorrow at 9:00, made last', (_c, id: string) => madeLast(id, { todo_due: dayAt(1, 9, 0).toISOString() }));
    And('a card {string} that fell due yesterday at 18:30, made last', (_c, id: string) => madeLast(id, { todo_due: dayAt(-1, 18, 30).toISOString() }));
    And('a card {string} due in 5 days at 9:00, made last', (_c, id: string) => madeLast(id, { todo_due: dayAt(5, 9, 0).toISOString() }));
    When('the To do tab opens', tabOpens);
    Then('the list {string} reads in order {string}, {string}, {string}, {string}, {string} then {string}', async (_c, list: string, ...expected: string[]) => {
      const column = await listNamed(list);
      await waitFor(() => expect(namesIn(column)).toEqual(expected));
    });
  });

  // mw-ev7oyy.12: link chips on a card's front, from the Open: line of its notes.
  const SAME_GIVEN = 'a view with a list {string} holding two open cards, a closed card and a card that is not a to do';
  const longNotesEnding = (_c: unknown, id: string, line: string) => hasNotes(_c, id, `${'Chapter notes for the class, written long. '.repeat(10)}\\n\\n${line}`);
  const chipsOf = (el: HTMLElement) => within(el).queryAllByRole('link').map((link) => link.textContent);
  const wordsOf = (...names: string[]) => names;
  const chipsShown = (name: string, ...expected: string[]) =>
    async () => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(chipsOf(el)).toEqual(expected));
    };
  const tapChip = async (_c: unknown, chip: string, name: string) => {
    const el = await card(name.replace('Title of ', ''));
    await userEvent.click(await within(el).findByRole('link', { name: chip }));
  };
  const chipOpens = (target: string | null) => async (_c: unknown, chip: string, url: string) => {
    await screen.findByRole('link', { name: chip });
    await waitFor(() => {
      const link = screen.getByRole('link', { name: chip });
      expect(link).toHaveAttribute('href', url);
      if (target) expect(link).toHaveAttribute('target', target);
      else expect(link).not.toHaveAttribute('target');
    });
  };

  Scenario('mw-ev7oyy.12 AC-1: a card whose notes end in an Open: line shows a chip for each link, and a tap opens the link, not the back', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows the chips {string} and {string} under its title', async (_c, name: string, one: string, two: string) => chipsShown(name, one, two)());
    And('the card {string} has the chip links named {string} and {string}', async (_c, name: string, one: string, two: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(within(el).getByRole('link', { name: one })).toBeInTheDocument();
      expect(within(el).getByRole('link', { name: two })).toBeInTheDocument();
      // under the title: after the title's button in the card
      const order = Array.from(el.querySelectorAll('button, a')).map((node) => node.textContent);
      expect(order.indexOf('Kindle')).toBeGreaterThan(order.findIndex((text) => text?.startsWith('Title of')));
    });
    When('he taps the chip {string} on the card {string}', tapChip);
    Then('the chip {string} opens {string} in a new tab', chipOpens('_blank'));
    And('the chip {string} opens {string} in the same tab', chipOpens(null));
    And('the card {string} is still on its front, not done, with nothing waiting in the outbox', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(screen.queryByRole('group', { name: /^Back of/ })).toBeNull();
      expect(within(el).getByRole('button', { name: DONE })).toBeEnabled();
      expect(await db.outbox.count()).toBe(0);
    });
  });

  Scenario('mw-ev7oyy.12 AC-1: a card with no Open: line shows no chips', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows no chips', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      await within(el).findByRole('button', { name: DONE });
      expect(chipsOf(el)).toEqual([]);
    });
  });

  Scenario('mw-ev7oyy.12 AC-1: an Open: line of five links shows the first four', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows the chips {string}, {string}, {string} and {string} under its title', async (_c, name: string, ...chips: string[]) => chipsShown(name, ...wordsOf(...chips))());
  });

  Scenario("mw-ev7oyy.12 AC-1: an Open: line past the view's short summary of the notes still shows its chips", ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And("the card {string} has long notes, longer than the view's summary, ending {string}", longNotesEnding);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows the chips {string} and {string} under its title', async (_c, name: string, one: string, two: string) => chipsShown(name, one, two)());
  });

  Scenario("mw-ev7oyy.12 AC-6: a tel: chip opens in the same tab, for the phone's dialer", ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the chip {string} opens {string} in the same tab', chipOpens(null));
  });
  // mw-ev7oyy.22: a Text button on a card's front, from the Text: line of its notes.
  const textButton = (el: HTMLElement) => within(el).queryByTestId('card-text');
  const textOpens = async (_c: unknown, name: string, href: string) => {
    await waitFor(() => {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('data-testid', 'card-text');
      expect(link).toHaveAttribute('href', href);
      expect(link).not.toHaveAttribute('target');
    });
  };

  Scenario('mw-ev7oyy.22 AC-1: a card whose notes have a Text: line shows a Text button that opens his texting app to the person with the message filled in', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows a Text button named {string} under its title', async (_c, name: string, button: string) => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(textButton(el)).toHaveTextContent(button));
      expect(within(el).getByRole('link', { name: button })).toBe(textButton(el));
      const order = Array.from(el.querySelectorAll('button, a')).map((node) => node.textContent);
      expect(order.indexOf(button)).toBeGreaterThan(order.findIndex((text) => text?.startsWith('Title of')));
    });
    And('the Text button {string} opens {string} in the same tab', textOpens);
    When('he taps the Text button {string} on the card {string}', async (_c, button: string, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      await userEvent.click(within(el).getByRole('link', { name: button }));
    });
    Then('the card {string} is still on its front, not done, with nothing waiting in the outbox', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(screen.queryByRole('group', { name: /^Back of/ })).toBeNull();
      expect(within(el).getByRole('button', { name: DONE })).toBeEnabled();
      expect(await db.outbox.count()).toBe(0);
    });
  });

  Scenario('mw-ev7oyy.22 AC-1: a Text: line with no number opens his texting app with the message only, for him to pick the person', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the Text button {string} opens {string} in the same tab', textOpens);
  });

  Scenario('mw-ev7oyy.22 AC-2: a card with no Text: line shows no Text button', ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows the chip {string} and no Text button', async (_c, name: string, chip: string) => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(chipsOf(el)).toEqual([chip]));
      expect(textButton(el)).toBeNull();
    });
  });

  Scenario("mw-ev7oyy.22 AC-1: a Text: line past the view's short summary of the notes still shows its Text button", ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And("the card {string} has long notes, longer than the view's summary, ending {string}", longNotesEnding);
    When('the To do tab opens', tabOpens);
    Then('the Text button {string} opens {string} in the same tab', textOpens);
  });
  Scenario("mw-ev7oyy.23 AC-2: on Android the Text button opens Google Voice by name, not the phone's default texting app", ({ Given, When, And, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the phone is an Android phone running Chrome', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36');
    });
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} shows a Text button named {string} under its title', async (_c, name: string, button: string) => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(textButton(el)).toHaveTextContent(button));
    });
    And('the Text button {string} opens {string} in the same tab', textOpens);
  });
  // mw-ev7oyy.14: a short list name, a one-row card with a round check, a hint shown till he has swiped once.
  const longList = (_c: unknown, id: string, epicTitle: string) => {
    beads.push(beadIn(id, { type: 'epic', labels: ['hitl'], title: epicTitle }), beadIn(`${id}.1`, { parent: id, labels: ['hitl', 'hitl:todo'] }));
  };
  const headerIsOneLine = async (_c: unknown, name: string) => {
    const column = await screen.findByRole('region', { name });
    const header = within(column).getByRole('heading', { level: 2 });
    expect(header).toHaveTextContent(name);
    expect(header.className).toMatch(/\btruncate\b/);
    expect(header.className).not.toMatch(/wrap-anywhere/);
  };
  Scenario('mw-ev7oyy.14 AC-1: a list whose epic has a long title is headed by its short name, the whole title on its menu', ({ Given, When, Then, And }) => {
    Given('a list {string} whose epic title is {string}', longList);
    When('the To do tab opens', tabOpens);
    Then('the board has a column named {string} whose header is one line, cut with an ellipsis', headerIsOneLine);
    And('the menu of the list {string} gives its whole title {string}', async (_c, name: string, whole: string) => {
      const column = await screen.findByRole('region', { name });
      await userEvent.click(within(column).getByRole('button', { name: 'List menu' }));
      expect(within(await screen.findByRole('menu', { name: 'List menu' })).getByText(whole)).toBeInTheDocument();
    });
  });

  Scenario('mw-ev7oyy.14 AC-1: a list whose epic has a todo_name is headed by that name', ({ Given, When, Then, And }) => {
    Given('a list {string} whose epic title is {string}', longList);
    And('the epic {string} has the todo_name {string}', (_c, id: string, name: string) => {
      (beads.find((b) => b.id === id) as ViewBead).todo_name = name;
    });
    When('the To do tab opens', tabOpens);
    Then('the board has a column named {string} whose header is one line, cut with an ellipsis', headerIsOneLine);
  });

  Scenario('mw-ev7oyy.14 AC-2: a card is one row with a small round check named Done and its title, and a tap on the check does what Done did', ({ Given, When, Then, And }) => {
    Given(SAME_GIVEN, aList);
    When('the To do tab opens', tabOpens);
    Then('the card {string} has the round check {string} and no button named just Done', async (_c, name: string, check: string) => {
      const el = await card(name.replace('Title of ', ''));
      const round = await within(el).findByRole('button', { name: check });
      expect(round.className).toMatch(/rounded-full/);
      expect(within(el).queryByRole('button', { name: 'Done' })).toBeNull();
    });
    When('he taps the round check of the card {string}', tapDone);
    Then('a close action for {string} waits in the outbox', async (_c, bead: string) => {
      await waitFor(async () => expect(await db.outbox.toArray()).toMatchObject([{ kind: 'action', bead, payload: { action: { action: 'close', bead } } }]));
    });
    And('the card {string} says {string} and offers no Done button', async (_c, name: string, words: string) => {
      const el = await card(name.replace('Title of ', ''));
      await waitFor(() => expect(within(el).getByText(words)).toBeInTheDocument());
      expect(within(el).queryByRole('button', { name: DONE })).toBeNull();
      expect(el.className).toMatch(/opacity-/);
    });
    And('the card {string} still offers Done', async (_c, name: string) => {
      const el = await card(name.replace('Title of ', ''));
      expect(within(el).getByRole('button', { name: DONE })).toBeEnabled();
    });
  });

  const HINT = 'Swipe sideways for the next list. Hold a card to move it.';
  Scenario('mw-ev7oyy.14 AC-1: the swipe hint shows until he has swiped once, and then not again', ({ Given, When, Then, And }) => {
    Given(SAME_GIVEN, aList);
    And('a second list {string} holding one open card', secondList);
    When('the To do tab opens', tabOpens);
    Then('the board hints {string}', async (_c, words: string) => {
      expect(words).toBe(HINT);
      expect(await screen.findByText(HINT)).toBeInTheDocument();
    });
    When('he swipes the lists sideways', async () => {
      const lists = await screen.findByTestId('todo-lists');
      await act(async () => {
        lists.scrollLeft = 300;
        fireEvent.scroll(lists);
      });
    });
    Then('the board shows no swipe hint', async () => {
      await waitFor(() => expect(screen.queryByText(HINT)).toBeNull());
    });
    When('the To do tab is opened again', async () => {
      cleanup();
      render(
        <Shell route={{ view: 'todo' }}>
          <TodoScreen />
        </Shell>,
      );
      await screen.findByTestId('todo-lists');
    });
    Then('the board still shows no swipe hint', async () => {
      await screen.findByTestId('todo-lists');
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });

  // mw-ev7oyy.16: Today, Soon and Someday. The groups start as he first finds them (Today open, the others folded) only when a scenario says so.
  const asFound = async () => {
    groupsAsFound = true;
    await tabOpens();
  };
  const groupLabels = (column: HTMLElement) => within(column).queryAllByTestId('todo-group').map((group) => group.querySelector('button')?.getAttribute('aria-label'));
  const hasGroups = async (_c: unknown, list: string, labels: string) => {
    const column = await listNamed(list);
    await waitFor(() => expect(groupLabels(column)).toEqual(labels.split(' / ')));
  };
  const showsOnly = async (_c: unknown, list: string, ...expected: string[]) => {
    const column = await listNamed(list);
    await waitFor(() => expect(namesIn(column)).toEqual(expected));
  };
  const tapGroup = async (_c: unknown, name: string, list: string) => {
    await userEvent.click(within(await listNamed(list)).getByRole('button', { name }));
  };
  const tapOnBack = async (_c: unknown, name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }));
  };
  const reopen = async () => {
    cleanup();
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
    await screen.findByTestId('todo-lists');
  };
  const SOME = 'a view with a list {string} holding two open cards, a closed card and a card that is not a to do';
  const dueTodayAt23 = (_c: unknown, id: string) => madeLast(id, { todo_due: dayAt(0, 23, 0).toISOString() });

  Scenario('mw-ev7oyy.16 AC-1: a list groups its cards into Today, Soon and Someday, each with its count, Today open and the others folded', ({ Given, And, When, Then }) => {
    Given(SOME, aList);
    And('a card {string} that is important, made last', (_c, id: string) => madeLast(id, { todo_important: true }));
    And('a card {string} due in 5 days at 9:00, made last', (_c, id: string) => madeLast(id, { todo_due: dayAt(5, 9, 0).toISOString() }));
    And('a card {string} that fell due yesterday at 18:30, made last', (_c, id: string) => madeLast(id, { todo_due: dayAt(-1, 18, 30).toISOString() }));
    And('a card {string} due today at 23:00, made last', dueTodayAt23);
    When('the To do tab opens with the groups as he first finds them', asFound);
    Then('the list {string} has the groups {string}', hasGroups);
    And('the list {string} shows only {string} then {string}', showsOnly);
  });

  Scenario('mw-ev7oyy.16 AC-1: a group with no cards is not shown', ({ Given, When, Then }) => {
    Given(SOME, aList);
    When('the To do tab opens with the groups as he first finds them', asFound);
    Then('the list {string} has the groups {string}', hasGroups);
  });

  Scenario('mw-ev7oyy.16 AC-2: a folded group opens with one tap, and each list keeps what he opened across a reload', ({ Given, And, When, Then }) => {
    Given(SOME, aList);
    And('a card {string} that is important, made last', (_c, id: string) => madeLast(id, { todo_important: true }));
    And('a second list {string} holding one open card', secondList);
    When('the To do tab opens with the groups as he first finds them', asFound);
    And('he taps {string} on the list {string}', tapGroup);
    Then('the list {string} has the groups {string}', hasGroups);
    And('the list {string} shows only {string}', showsOnly);
    When('the To do tab is opened again', reopen);
    Then('the list {string} still has the groups {string}', hasGroups);
    And('the list {string} keeps the groups {string}', hasGroups);
  });

  Scenario("mw-ev7oyy.16 AC-3: a card's back moves it to Today for today only, and the next day it is back in its own group", ({ Given, When, And, Then }) => {
    Given(SOME, aList);
    When('the To do tab opens with the groups as he first finds them', asFound);
    And('he taps {string} on the list {string}', tapGroup);
    And('he taps the card {string}', tapCard);
    And("he taps {string} on the card's back", tapOnBack);
    And('he taps Back on the card', tapBack);
    Then('the list {string} has the groups {string}', hasGroups);
    And('the list {string} shows only {string} then {string}', showsOnly);
    When('it is the next day and the To do tab is opened again', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now + 86_400_000));
      await reopen();
    });
    Then('the list {string} still has the groups {string}', hasGroups);
    And('the list {string} again shows only {string} then {string}', showsOnly);
  });

  Scenario('mw-ev7oyy.16 AC-3: a card tapped into Today offers Back to its own group, and that puts it back', ({ Given, When, And, Then }) => {
    Given(SOME, aList);
    When('the To do tab opens with the groups as he first finds them', asFound);
    And('he taps {string} on the list {string}', tapGroup);
    And('he taps the card {string}', tapCard);
    And("he taps {string} on the card's back", tapOnBack);
    Then("the card's back offers {string} and not {string}", async (_c, offered: string, not: string) => {
      expect(await screen.findByRole('button', { name: offered })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: not })).toBeNull();
    });
    When("he then taps {string} on the card's back", tapOnBack);
    Then('the list {string} has the groups {string}', hasGroups);
  });

  Scenario('mw-ev7oyy.16 AC-1: a card added to a folded Someday is seen at once, pending', ({ Given, When, And, Then }) => {
    Given(SOME, aList);
    When('the To do tab opens with the groups as he first finds them', asFound);
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
});
