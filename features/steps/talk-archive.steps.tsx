// features/steps/talk-archive.steps.tsx — runs features/talk-archive.feature
// (mw-2y46l.6): the Talk screen against a seeded Dexie (a view and some messages),
// no network. Bead titles read "Title of <id>" so a row is found by its title; a
// bead the view lacks shows its id.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { useRoute } from '../../src/router';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo, viewRepo } from '../../src/data/repositories';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import type { ViewBead } from '../../src/model/view';

configure({ asyncUtilTimeout: 5000 });

const DAY = 86_400_000;

let now = Date.now();
let beads: ViewBead[] = [];
let seeded: MessageRow[] = [];
let sequence = 0;

function beadIn(id: string, status: 'open' | 'closed'): ViewBead {
  const template = fixtureView(now).beads[0];
  return { ...template, id, title: `Title of ${id}`, status, parent: undefined, type: 'task', labels: [], waits: [], closed: status === 'closed' ? new Date(now).toISOString() : '' };
}

function messageOn(thread: string | undefined, at: number): MessageRow {
  sequence += 1;
  return {
    id: `${'ab'.repeat(31)}${String(sequence).padStart(2, '0')}:0`,
    txid: `${'ab'.repeat(31)}${String(sequence).padStart(2, '0')}`,
    vout: 0,
    seq: sequence,
    class: 'message',
    to: '02'.padEnd(66, '0'),
    from: '03'.padEnd(66, '0'),
    ts: Math.floor(at / 1000),
    ciphertext: '',
    plaintext: 'A word from the Mayor',
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
  await Promise.all([db.settings.clear(), db.messages.clear(), db.view.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', '/?v=talk');
}

// A stand-in for App's routing: Talk on whatever thread the URL names.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const route = useRoute();
  return <TalkScreen thread={route.view === 'talk' ? route.thread : undefined} />;
}

async function openTalk(): Promise<void> {
  cleanup();
  await viewRepo.save({ plaintext: JSON.stringify({ ...fixtureView(now), beads }), written_at: new Date(now).toISOString(), source: 'live', fetchedAt: now });
  for (const row of seeded) await messagesRepo.put(row);
  render(<Harness />);
  // Opened on one thread's own screen (narrow), there is no list until he leaves it.
  if (window.location.search.includes('&t=')) return;
  await screen.findByTestId('thread-list');
}

const title = (id: string) => `Title of ${id}`;
const liveList = () => screen.getByTestId('thread-list');
const rowOf = (id: string) => within(liveList()).queryByText(title(id));

async function openArchived(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Archived (1)' }));
}

async function archiveFromRow(id: string): Promise<void> {
  await waitFor(() => expect(rowOf(id)).toBeInTheDocument());
  await userEvent.click(within(liveList()).getByRole('button', { name: `Archive ${title(id)}` }));
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/talk-archive.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const closedBead = (id: string) => {
    beads.push(beadIn(id, 'closed'));
  };
  const openBead = (id: string) => {
    beads.push(beadIn(id, 'open'));
  };
  const spokenAgo = (id: string, days: string) => {
    seeded.push(messageOn(`bead:${id}`, now - Number(days) * DAY));
  };
  const talkOpens = openTalk;
  const listShows = async (id: string) => {
    await waitFor(() => expect(rowOf(id)).toBeInTheDocument());
  };
  const archivedRowShown = async () => {
    expect(await screen.findByRole('button', { name: 'Archived (1)' })).toBeInTheDocument();
  };
  const noArchivedRow = async () => {
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument());
  };
  const archivedListShows = async (id: string) => {
    const list = await screen.findByTestId('archived-list');
    expect(within(list).getByText(title(id))).toBeInTheDocument();
  };
  const listHasNothingOf = async (id: string) => {
    await waitFor(() => expect(rowOf(id)).not.toBeInTheDocument());
  };
  const newMessageOn = async (id: string) => {
    await messagesRepo.put(messageOn(`bead:${id}`, Date.now() + 1000));
  };

  Scenario("mw-2y46l.6: a closed bead's thread quiet 4 days is under Archived, one quiet 1 day is not", ({ Given, And, When, Then }) => {
    Given('the bead {string} is closed and the bead {string} is closed', (_c, a: string, b: string) => {
      closedBead(a);
      closedBead(b);
    });
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    And('the thread of {string} had its last word {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    Then('the thread list shows {string} and not {string}', async (_c, shown: string, hidden: string) => {
      await listShows(shown);
      expect(rowOf(hidden)).not.toBeInTheDocument();
    });
    And('an {string} row is shown', archivedRowShown);
    When('the {string} row is tapped', openArchived);
    Then('the archived list shows {string}', (_c, id: string) => archivedListShows(id));
  });

  Scenario('mw-2y46l.6: a bead the view no longer lists is treated as closed', ({ Given, And, When, Then }) => {
    Given('the view lists no bead {string}', () => {
      beads.push(beadIn('mw-other.1', 'open'));
    });
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    Then('an {string} row is shown', archivedRowShown);
  });

  Scenario("mw-2y46l.6: an open bead's thread is never auto-archived", ({ Given, And, When, Then }) => {
    Given('the bead {string} is open', (_c, id: string) => openBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    Then('the thread list shows {string}', (_c, id: string) => listShows(id));
    And('no Archived row is shown', noArchivedRow);
  });

  Scenario('mw-2y46l.6: a hand-archived thread moves to Archived and Unarchive brings it back', ({ Given, And, When, Then }) => {
    Given('the bead {string} is open', (_c, id: string) => openBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    And('the thread {string} is archived from its row', (_c, id: string) => archiveFromRow(id));
    Then('the thread list shows nothing of {string}', (_c, id: string) => listHasNothingOf(id));
    And('an {string} row is shown', archivedRowShown);
    When('the {string} row is tapped', openArchived);
    And('Unarchive is tapped on {string}', async (_c, id: string) => {
      const list = await screen.findByTestId('archived-list');
      await userEvent.click(within(list).getByRole('button', { name: `Unarchive ${title(id)}` }));
    });
    Then('the thread list shows {string}', (_c, id: string) => listShows(id));
    And('no Archived row is shown', noArchivedRow);
  });

  Scenario('mw-2y46l.6: a thread opened on its own screen can be archived from there', ({ Given, And, When, Then }) => {
    Given('the bead {string} is open', (_c, id: string) => openBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('the thread {string} is opened and its Archive control is tapped', async (_c, id: string) => {
      window.history.replaceState(null, '', `/?v=talk&t=${encodeURIComponent(`bead:${id}`)}`);
      await openTalk();
      await userEvent.click(await screen.findByRole('button', { name: 'Archive thread' }));
    });
    Then('the thread list shows nothing of {string}', (_c, id: string) => listHasNothingOf(id));
    And('an {string} row is shown', archivedRowShown);
  });

  Scenario('mw-2y46l.6: a new message un-archives a thread', ({ Given, And, When, Then }) => {
    Given('the bead {string} is closed', (_c, id: string) => closedBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    Then('an {string} row is shown', archivedRowShown);
    When('a new message arrives on the thread of {string}', (_c, id: string) => newMessageOn(id));
    Then('the thread list shows {string}', (_c, id: string) => listShows(id));
    And('no Archived row is shown', noArchivedRow);
  });

  Scenario('mw-2y46l.6: a new message un-archives a thread he archived by hand', ({ Given, And, When, Then }) => {
    Given('the bead {string} is open', (_c, id: string) => openBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    And('the thread {string} is archived from its row', (_c, id: string) => archiveFromRow(id));
    And('a new message arrives on the thread of {string}', (_c, id: string) => newMessageOn(id));
    Then('the thread list shows {string}', (_c, id: string) => listShows(id));
    And('no Archived row is shown', noArchivedRow);
  });

  Scenario('mw-2y46l.6: Factory never archives', ({ Given, When, Then, And }) => {
    Given('the general thread was last spoken in {string} days ago', (_c, days: string) => {
      seeded.push(messageOn(undefined, now - Number(days) * DAY));
    });
    When('Talk opens', talkOpens);
    Then('the thread list shows {string}', async (_c, name: string) => {
      expect(await within(liveList()).findByText(name)).toBeInTheDocument();
    });
    And('Factory has no Archive control', () => {
      expect(within(liveList()).queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument();
    });
  });

  Scenario('mw-2y46l.6: search finds an archived thread', ({ Given, And, When, Then }) => {
    Given('the bead {string} is closed', (_c, id: string) => closedBead(id));
    And('the thread of {string} was last spoken in {string} days ago', (_c, id: string, days: string) => spokenAgo(id, days));
    When('Talk opens', talkOpens);
    And('{string} is typed into the thread search', async (_c, words: string) => {
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find a thread' }), words);
    });
    Then('the live list has no {string}', async (_c, id: string) => {
      expect(rowOf(id)).not.toBeInTheDocument();
    });
    And('the archived list shows {string}', (_c, id: string) => archivedListShows(id));
  });
});
