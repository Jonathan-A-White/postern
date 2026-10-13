// features/steps/todo-board.steps.tsx — runs features/todo-board.feature (mw-ev7oyy.4):
// the To do tab inside the Shell against a seeded Dexie view, no network. A bead's title reads
// "Title of <id>"; a tap on Done lands in the outbox as a close action.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
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
const notes = new Map<string, string>();

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  notes.clear();
  forgetTaps();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear()]);
  window.history.replaceState(null, '', '/?v=todo');
}

const title = (id: string) => `Title of ${id}`;
const card = async (id: string) => (await screen.findByText(title(id))).closest('[data-testid="todo-card"]') as HTMLElement;

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/todo-board.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

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
});
