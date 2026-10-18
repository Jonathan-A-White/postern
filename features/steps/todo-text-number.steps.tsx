// features/steps/todo-text-number.steps.tsx — runs features/todo-text-number.feature (mw-ev7oyy.35):
// a Text: line with a number, and a name-only one that shows the home's reason and a field for the number,
// against a seeded Dexie view, no network. A bead's title reads "Title of <id>".
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Shell } from '../../src/cockpit/Shell';
import { TodoScreen } from '../../src/cockpit/TodoScreen';
import { forgetTaps } from '../../src/cockpit/oneTap';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { forgetOutboxState } from '../../src/services/outbox';
import { settlePhone } from '../../tests/support/empty-phone';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { BeadDetail, ViewBead } from '../../src/model/view';

let now = Date.now();
let beads: ViewBead[] = [];
let viewSeq = 1;
const notes = new Map<string, string>();

function beadIn(id: string, extra: Partial<ViewBead>): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, type: 'task', status: 'open', parent: undefined, labels: [], waits: [], done_earlier: 0, closed: '', created: new Date(now - 3_600_000).toISOString(), ...extra };
}

async function save(): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), needs: [], beads, seq: viewSeq }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  viewSeq = 1;
  notes.clear();
  forgetTaps();
  await settlePhone();
  forgetOutboxState();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.beadDetails.clear(), db.outbox.clear(), db.events.clear()]);
  localStorage.clear();
  window.history.replaceState(null, '', '/?v=todo');
}

const card = async (name: string) => (await screen.findByText(name)).closest('[data-testid="todo-card"]') as HTMLElement;

afterAll(() => {
  vi.restoreAllMocks();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/todo-text-number.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(async () => {
    vi.restoreAllMocks();
    await fresh();
  });

  const SAME_GIVEN = 'a view with a list {string} holding two open cards, a closed card and a card that is not a to do';
  const aList = (_c: unknown, list: string) => {
    beads.push(
      beadIn(list, { type: 'epic', labels: ['hitl'] }),
      beadIn(`${list}.1`, { parent: list, labels: ['hitl', 'hitl:todo'], created: new Date(now - 7_200_000).toISOString() }),
      beadIn(`${list}.2`, { parent: list, labels: ['hitl', 'hitl:todo'] }),
      beadIn(`${list}.3`, { parent: list, labels: ['hitl', 'hitl:todo'], status: 'closed', closed: new Date(now).toISOString() }),
      beadIn(`${list}.4`, { parent: list, labels: ['hitl'] }),
    );
  };
  const hasNotes = (_c: unknown, id: string, text: string) => {
    const full = text.replaceAll('\\n', '\n');
    notes.set(id, full);
    const bead = beads.find((b) => b.id === id);
    if (bead) bead.summary = [...full].slice(0, 280).join('');
  };
  const putDetails = async () => {
    for (const [id, description] of notes) {
      const bead = beads.find((b) => b.id === id) as ViewBead;
      const detail: BeadDetail = { v: 2, ...bead, blocks: [], children: [], description, acceptance: '', comments: [{ at: new Date(now).toISOString(), author: 'mayor', text: 'Waiting on you.' }] };
      await db.beadDetails.put({ id, plaintext: JSON.stringify(detail), fetchedAt: now });
    }
  };
  const tabOpens = async () => {
    await save();
    localStorage.setItem('postern.todo.folds', JSON.stringify({ later: true }));
    await putDetails();
    render(
      <Shell route={{ view: 'todo' }}>
        <TodoScreen />
      </Shell>,
    );
  };
  const textOpens = async (_c: unknown, name: string, href: string) => {
    await waitFor(() => {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('data-testid', 'card-text');
      expect(link).toHaveAttribute('href', href);
    });
  };
  const noField = async (_c: unknown, name: string) => {
    const el = await card(name);
    // the Text button is drawn once the card is; the field would be drawn with it
    await waitFor(() => expect(within(el).getByTestId('card-text')).toBeInTheDocument());
    expect(within(el).queryByTestId('text-number')).toBeNull();
  };
  const says = async (_c: unknown, name: string, words: string) => {
    const el = await card(name);
    await waitFor(() => expect(within(el).getByTestId('text-number')).toHaveTextContent(words));
  };

  Scenario('mw-ev7oyy.35 AC-1: a Text: line the home gave a number opens the texting app to that number with the draft, and shows no number field', ({ Given, And, When, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the Text button {string} opens {string} in the same tab', textOpens);
    And('the card {string} shows no number field', noField);
  });

  Scenario('mw-ev7oyy.35 AC-1: a name-only Text: line shows the reason the home wrote and one field to add the number', ({ Given, And, When, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    Then('the card {string} says {string}', says);
    And('the card {string} has the field {string}', async (_c, name: string, field: string) => {
      const el = await card(name);
      expect(await within(el).findAllByLabelText(field)).toHaveLength(1);
    });
  });

  const typesAndSaves = async (_c: unknown, typed: string, field: string, name: string, button: string) => {
    const el = await card(name);
    const input = await within(el).findByLabelText(field);
    await userEvent.type(input, typed);
    const save = within(el).getByRole('button', { name: button });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
  };
  const outboxActions = async () => (await db.outbox.toArray()).map((row) => row.payload.action);

  Scenario('mw-ev7oyy.35 AC-2: a saved number goes to the home as one to do action, and once the home has written it the line opens Voice to the number and the field is gone', ({ Given, And, When, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    And('he types {string} into {string} on the card {string} and taps {string}', typesAndSaves);
    Then('one todo_edit for {string} waits in the outbox with the notes {string}', async (_c, bead: string, written: string) => {
      await waitFor(async () => expect(await outboxActions()).toEqual([{ action: 'todo_edit', bead, notes: written }]));
    });
    And('the card {string} says {string} in place of the field', async (_c, name: string, words: string) => {
      await says(_c, name, words);
      const el = await card(name);
      expect(within(el).queryByLabelText("Add Matthew's number")).toBeNull();
      expect(within(el).queryByRole('button', { name: 'Save number' })).toBeNull();
    });
    When('the home answers with the notes {string}', async (_c, written: string) => {
      hasNotes(_c, 'mw-list.1', written);
      viewSeq += 1;
      now += 5_000;
      await act(async () => {
        await save();
        await putDetails();
      });
    });
    Then('the Text button {string} opens {string} in the same tab', textOpens);
    And('the card {string} shows no number field', noField);
  });

  Scenario('mw-ev7oyy.35 AC-2: a number that is not a number is refused on the phone with a short reason and nothing is sent', ({ Given, And, When, Then }) => {
    Given(SAME_GIVEN, aList);
    And('the card {string} has the notes {string}', hasNotes);
    When('the To do tab opens', tabOpens);
    And('he types {string} into {string} on the card {string} and taps {string}', typesAndSaves);
    Then('the card {string} says {string}', says);
    And('nothing waits in the outbox', async () => {
      expect(await db.outbox.count()).toBe(0);
    });
  });
});
