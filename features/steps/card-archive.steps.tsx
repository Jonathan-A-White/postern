// features/steps/card-archive.steps.tsx — runs features/card-archive.feature (mw-v1uyku.1): the real
// message sync pages sealed `card`, `card-update`, `message` and `events` records, the clock is frozen
// (Date only) and moved by hand, and Needs you, the archive or Me is opened at the hour a scenario names.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { ArchiveScreen } from '../../src/cockpit/ArchiveScreen';
import { MeScreen } from '../../src/cockpit/MeScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage, type MessageClass } from '../../src/services/messages';
import { type View, type ViewBead } from '../../src/model/view';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { freezeClock, thawClock, FIXTURE_NOW } from '../../tests/support/freeze-clock';

configure({ asyncUtilTimeout: 5000 });

const HOUR = 3_600_000;
const GOV = PrivateKey.fromHex('44'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const SENT_AT = Date.parse(FIXTURE_NOW);

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

let page: ApiRecord[] = [];
let recordSeq = 0;
let eventSeq = 0;
let cardTxid = '';

function viewBead(id: string): ViewBead {
  return { id, title: `Title of ${id}`, type: 'task', status: 'in_progress', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

async function storeView(beads: string[]): Promise<void> {
  const written = new Date(SENT_AT).toISOString();
  const view: View = { ...fixtureView(SENT_AT), written_at: written, needs: [], beads: beads.map(viewBead) };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: written, etag: '"first"', source: 'live', fetchedAt: SENT_AT });
}

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function sealed(messageClass: MessageClass, text: string): ApiRecord {
  return record(encryptMessage({ text, class: messageClass, senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
}

function beadEvent(bead: string, from: string, to: string) {
  eventSeq += 1;
  return { seq: eventSeq, ts: new Date().toISOString(), kind: 'bead_changed', bead, actor: 'mw@laptop', from, to, detail: 'status', lane: 'normal' };
}

const backend = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.includes('/messages')) {
    const records = page;
    page = [];
    return new Response(JSON.stringify({ records, next: recordSeq }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

async function sync(records: ApiRecord[]): Promise<void> {
  page = records;
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

/** The clock `hours` after the card was sent. */
function atHour(hours: number): void {
  vi.setSystemTime(new Date(SENT_AT + hours * HOUR));
}

async function fresh(): Promise<void> {
  cleanup();
  freezeClock();
  page = [];
  recordSeq = 0;
  eventSeq = 0;
  cardTxid = '';
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.cards.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  cleanup();
  thawClock();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/card-archive.feature');

const cardNamed = (title: string) => screen.getByRole('article', { name: `Card: ${title}` });
const archiveLink = () => screen.getByRole('link', { name: /^Archived cards · \d+$/ });

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const GIVEN_CARD = 'the Mayor sent a card titled {string} on beads {string} and {string}';
  const sendCard = async (_c: unknown, title: string, a: string, b: string) => {
    await storeView([a, b]);
    const items = [a, b].map((bead, i) => ({ n: i + 1, text: `VERIFIED on ${bead}`, links: [bead], expect: { bead, state: 'verified' } }));
    const card = sealed('card', JSON.stringify({ title, items, subscribe: { kinds: ['bead_changed'], beads: [a, b] } }));
    cardTxid = card.txid;
    await sync([card]);
  };
  const openNeeds = async (hours: number) => {
    cleanup();
    atHour(hours);
    render(<NeedsScreen />);
    await screen.findByRole('tab', { name: /^You · \d+$/ });
  };
  const openNeedsAfter = async (_c: unknown, hours: number) => openNeeds(hours);
  const inYouList = async (_c: unknown, title: string) => {
    await waitFor(() => expect(cardNamed(title)).toBeInTheDocument());
  };
  const notInYouList = async (_c: unknown, title: string) => {
    await screen.findByRole('tab', { name: /^You · \d+$/ });
    await waitFor(() => expect(screen.queryByRole('article', { name: `Card: ${title}` })).toBeNull());
  };
  const archiveRow = async (_c: unknown, label: string) => {
    await waitFor(() => expect(archiveLink()).toHaveTextContent(label));
    expect(archiveLink()).toHaveAttribute('href', '?v=archive');
  };
  const verifiedArrives = async (_c: unknown, bead: string) => {
    await sync([record(encryptMessage({ text: JSON.stringify({ from: 1, to: 1, lane: 'normal', events: [beadEvent(bead, 'landed', 'verified')] }), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }))]);
  };
  const noArchiveRow = async () => {
    await screen.findByRole('tab', { name: /^You · \d+$/ });
    expect(screen.queryByRole('link', { name: /^Archived cards/ })).toBeNull();
  };

  Scenario('mw-v1uyku.1 AC1: a card sent 47 hours ago is still in Needs you', ({ Given, When, Then, And }) => {
    Given(GIVEN_CARD, sendCard);
    When('Needs you is opened {int} hours later', openNeedsAfter);
    Then('the card {string} is in the You list', inYouList);
    And('there is no "Archived cards" row', noArchiveRow);
  });

  Scenario('mw-v1uyku.1 AC1: at 49 hours the card is gone from Needs you and listed under Archived cards', ({ Given, When, Then, And }) => {
    Given(GIVEN_CARD, sendCard);
    When('Needs you is opened {int} hours later', openNeedsAfter);
    Then('the card {string} is not in the You list', notInYouList);
    And('an {string} row links to the archive', archiveRow);
  });

  Scenario('mw-v1uyku.1 AC1: opening the card in the archive shows its items', ({ Given, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    When('the archive is opened {int} hours later', async (_c, hours: number) => {
      cleanup();
      atHour(hours);
      render(<ArchiveScreen />);
      await screen.findByRole('heading', { name: 'Archived cards' });
    });
    Then('the archive lists the card {string} closed, with {int} of {int} done', async (_c, title: string, done: number, of: number) => {
      const toggle = await screen.findByRole('button', { name: new RegExp(`^${title}`) });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveTextContent(`${done} of ${of} done`);
      expect(screen.queryByRole('article', { name: `Card: ${title}` })).toBeNull();
    });
    When('the card {string} is opened in the archive', async (_c, title: string) => {
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }));
    });
    Then('its items {int} and {int} are shown', async (_c, first: number, second: number) => {
      const rows = within(await screen.findByRole('article', { name: 'Card: Top 5' })).getAllByTestId('live-card-item');
      expect(rows.map((row) => within(row).getByTestId('live-card-item-text').textContent)).toEqual([`${first}. VERIFIED on mw-a.1`, `${second}. VERIFIED on mw-b.1`]);
    });
  });

  Scenario('mw-v1uyku.1 AC1: an event that ticks an item brings the card back to Needs you', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('Needs you is opened {int} hours later', openNeedsAfter);
    When('the event that bead {string} is verified arrives', verifiedArrives);
    Then('the card {string} is in the You list', inYouList);
    And('there is no "Archived cards" row', noArchiveRow);
  });

  Scenario('mw-v1uyku.1 AC1: an update brings the card back to Needs you', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('Needs you is opened {int} hours later', openNeedsAfter);
    When('the Mayor sends a card-update for that card adding the link {string} to item 2', async (_c, bead: string) => {
      await sync([sealed('card-update', JSON.stringify({ re: cardTxid, links: { 2: [bead] } }))]);
    });
    Then('the card {string} is in the You list', inYouList);
    And('there is no "Archived cards" row', noArchiveRow);
  });

  Scenario('mw-v1uyku.1 AC1: a message that names the card\'s bead brings it back to Needs you', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('Needs you is opened {int} hours later', openNeedsAfter);
    When('a message arrives in the thread of bead {string}', async (_c, bead: string) => {
      await sync([sealed('message', JSON.stringify({ thread: { bead }, text: 'Here is the screenshot' }))]);
    });
    Then('the card {string} is in the You list', inYouList);
  });

  Scenario('mw-v1uyku.1 AC1: a tap on one of its links counts as touched', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('the card was sent {int} hours ago and Needs you is open', openNeedsAfter);
    When('he taps the link to bead {string}', async (_c, bead: string) => {
      const link = within(cardNamed('Top 5')).getAllByRole('link', { name: `Title of ${bead}` })[0];
      link.addEventListener('click', (event) => event.preventDefault());
      await userEvent.click(link);
      await waitFor(async () => expect((await db.cards.get(cardTxid))?.touchedAt).toBe(SENT_AT + 47 * HOUR));
    });
    And('{int} hours pass and Needs you is opened again', async (_c, hours: number) => openNeeds(47 + hours));
    Then('the card {string} is in the You list', inYouList);
  });

  Scenario('mw-v1uyku.1 AC1: without a tap the same card is archived at 50 hours', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('the card was sent {int} hours ago and Needs you is open', openNeedsAfter);
    When('{int} hours pass and Needs you is opened again', async (_c, hours: number) => openNeeds(47 + hours));
    Then('the card {string} is not in the You list', notInYouList);
  });

  Scenario('mw-v1uyku.1 AC2: a card in the archive keeps ticking, with the archive closed and nothing reloaded', ({ Given, And, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    And('Needs you is opened {int} hours later', openNeedsAfter);
    When('the event that bead {string} is verified arrives', verifiedArrives);
    Then('item {int} of the card {string} shows a tick', async (_c, n: number, title: string) => {
      await waitFor(() => expect(within(cardNamed(title)).getAllByTestId('live-card-item')[n - 1]).toHaveAttribute('data-done', 'true'));
    });
  });

  Scenario('mw-v1uyku.1: Share still works on a card in the archive', ({ Given, When, And, Then }) => {
    Given(GIVEN_CARD, sendCard);
    When('the archive is opened {int} hours later', async (_c, hours: number) => {
      cleanup();
      atHour(hours);
      render(<ArchiveScreen />);
      await screen.findByRole('heading', { name: 'Archived cards' });
    });
    And('the card {string} is opened in the archive', async (_c, title: string) => {
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }));
    });
    Then('the card {string} has a Share button', async (_c, title: string) => {
      expect(await within(await screen.findByRole('article', { name: `Card: ${title}` })).findByRole('button', { name: 'Share' })).toBeInTheDocument();
    });
  });

  Scenario('mw-v1uyku.1: Me has an Archived cards row too', ({ Given, When, Then }) => {
    Given(GIVEN_CARD, sendCard);
    When('Me is opened {int} hours later', async (_c, hours: number) => {
      cleanup();
      atHour(hours);
      render(<MeScreen />);
    });
    Then('an {string} row links to the archive', archiveRow);
  });
});
