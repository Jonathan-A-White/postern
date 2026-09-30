// features/steps/talk-latest.steps.tsx — runs features/talk-latest.feature
// (mw-gq6.158): the Talk list against a seeded Dexie (a view, messages and one
// bead's stored detail holding a Mayor note), no network.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db, type MessageRow } from '../../src/data/db';
import { beadDetailsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const DAY = 86_400_000;
const MINUTE = 60_000;

let now = Date.now();
let beads: ViewBead[] = [];
let seeded: MessageRow[] = [];
let notes: { bead: ViewBead; text: string; at: number }[] = [];
let sequence = 0;

function beadIn(id: string): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, status: 'open', parent: undefined, type: 'task', labels: [], waits: [], closed: '' };
}

function messageOn(thread: string, at: number, text: string): MessageRow {
  sequence += 1;
  return {
    id: `${'cd'.repeat(31)}${String(sequence).padStart(2, '0')}:0`,
    txid: `${'cd'.repeat(31)}${String(sequence).padStart(2, '0')}`,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(at / 1000),
    ciphertext: '',
    plaintext: text,
    direction: 'received',
    read: true,
    thread,
  };
}

async function fresh(): Promise<void> {
  cleanup();
  now = Date.now();
  beads = [];
  seeded = [];
  notes = [];
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

async function openTalk(): Promise<void> {
  cleanup();
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  for (const { bead, text, at } of notes) {
    const detail = { ...bead, comments: [{ author: 'mayor', at: new Date(at).toISOString(), text }] };
    await beadDetailsRepo.save({ id: bead.id, plaintext: JSON.stringify(detail), fetchedAt: now });
  }
  render(<TalkScreen />);
  await screen.findByTestId('thread-list');
}

const rowOf = (id: string) => screen.getByText(`Title of ${id}`).closest('li') as HTMLElement;

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-latest.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const beadWithMessage = (id: string, text: string, days: string) => {
    beads.push(beadIn(id));
    seeded.push(messageOn(`bead:${id}`, now - Number(days) * DAY, text));
  };
  const previews = async (id: string, text: string) => {
    await waitFor(() => expect(within(rowOf(id)).getByText(text)).toBeInTheDocument());
  };

  Scenario("mw-gq6.158: a Mayor note newer than the last message is the row's preview and order", ({ Given, And, When, Then }) => {
    Given('the bead {string} is open with a message {string} from {string} days ago', (_c, id: string, text: string, days: string) => beadWithMessage(id, text, days));
    And('the bead {string} has a Mayor note {string} from {string} minutes ago', (_c, id: string, text: string, minutes: string) => {
      notes.push({ bead: beads.find((bead) => bead.id === id)!, text, at: now - Number(minutes) * MINUTE });
    });
    And('the bead {string} is open with a message {string} from {string} day ago', (_c, id: string, text: string, days: string) => beadWithMessage(id, text, days));
    When('Talk opens', openTalk);
    Then('the row of {string} previews {string}', (_c, id: string, text: string) => previews(id, text));
    And('the row of {string} is listed above the row of {string}', async (_c, upper: string, lower: string) => {
      await waitFor(() => expect(rowOf(upper).compareDocumentPosition(rowOf(lower)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    });
  });

  Scenario('mw-gq6.158: a thread with only messages keeps its last message as the preview', ({ Given, When, Then }) => {
    Given('the bead {string} is open with a message {string} from {string} day ago', (_c, id: string, text: string, days: string) => beadWithMessage(id, text, days));
    When('Talk opens', openTalk);
    Then('the row of {string} previews {string}', (_c, id: string, text: string) => previews(id, text));
  });
});
