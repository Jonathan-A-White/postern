// features/steps/live-card.steps.tsx — runs features/live-card.feature (mw-nqur1n.11): the real
// message sync pages sealed `card`, `card-update` and `events` records (docs/protocol.md §22, §24)
// and Needs you, or a thread, shows the one live card; only the backend is a fetch double, and it
// counts every GET /api/view so a scenario can say nothing was fetched again.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { TalkScreen } from '../../src/cockpit/TalkScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { sealDocument } from '../../src/services/documents';
import { syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage, type MessageClass } from '../../src/services/messages';
import { type View, type ViewBead } from '../../src/model/view';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const GOV = PrivateKey.fromHex('44'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const WRITTEN = '2026-10-01T12:00:00Z';

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

interface CardItemBody {
  n: number;
  text: string;
  links: string[];
  expect?: { bead: string; state: string };
}

let page: ApiRecord[] = [];
let viewFetches = 0;
let recordSeq = 0;
let eventSeq = 0;
let cardTxid = '';

function viewBead(id: string): ViewBead {
  return { id, title: `Title of ${id}`, type: 'task', status: 'in_progress', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

async function storeView(beads: string[]): Promise<void> {
  const view: View = { ...fixtureView(Date.parse(WRITTEN)), written_at: WRITTEN, needs: [], beads: beads.map(viewBead) };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: WRITTEN, etag: '"first"', source: 'live', fetchedAt: Date.parse(WRITTEN) });
}

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function sealed(messageClass: MessageClass, body: unknown): ApiRecord {
  return record(encryptMessage({ text: JSON.stringify(body), class: messageClass, senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
}

function beadEvent(bead: string, from: string, to: string) {
  eventSeq += 1;
  return { seq: eventSeq, ts: new Date().toISOString(), kind: 'bead_changed', bead, actor: 'mw@laptop', from, to, detail: 'status', lane: 'normal' };
}

function eventsRecord(events: Array<{ seq: number }>): ApiRecord {
  return sealed('events', { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events });
}

const backend = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.includes('/messages')) {
    const records = page;
    page = [];
    return new Response(JSON.stringify({ records, next: recordSeq }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/view')) {
    viewFetches += 1;
    const sealedView = await sealDocument(JSON.stringify({ ...fixtureView(Date.parse(WRITTEN)), written_at: '2026-10-01T12:05:00Z' }), MAYOR.toHex(), GOV_PUB);
    return new Response(sealedView, { status: 200, headers: { ETag: '"second"' } });
  }
  return new Response('not found', { status: 404 });
};

async function sync(records: ApiRecord[]): Promise<void> {
  page = records;
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

function items(beads: string[]): CardItemBody[] {
  return beads.map((bead, i) => ({ n: i + 1, text: `VERIFIED on ${bead}`, links: [bead], expect: { bead, state: 'verified' } }));
}

async function sendCard(title: string, beads: string[], thread?: string): Promise<void> {
  const card = sealed('card', { title, items: items(beads), subscribe: { kinds: ['bead_changed'], beads }, ...(thread ? { thread: { bead: thread } } : {}) });
  cardTxid = card.txid;
  await sync([card]);
}

async function fresh(): Promise<void> {
  cleanup();
  page = [];
  viewFetches = 0;
  recordSeq = 0;
  eventSeq = 0;
  cardTxid = '';
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.cards.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/live-card.feature');

const card = () => screen.getByRole('article', { name: 'Card: Top 5' });
const itemRows = () => within(card()).getAllByTestId('live-card-item');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const openWithCard = async (_c: unknown, title: string, a: string, b: string, c: string) => {
    await storeView([a, b, c]);
    await sendCard(title, [a, b, c]);
    render(<NeedsScreen />);
    await screen.findByRole('article', { name: `Card: ${title}` });
  };
  const GIVEN_CARD = 'Needs you is open and the Mayor has sent a card titled {string} with three items on beads {string}, {string} and {string}';

  Scenario('mw-nqur1n.11: a card record shows its items with their links in Needs you', ({ Given, Then, And }) => {
    Given(GIVEN_CARD, openWithCard);
    Then('the card {string} is in the You list', async (_c, title: string) => {
      expect(screen.getByRole('article', { name: `Card: ${title}` })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^You · 1$/ })).toBeInTheDocument();
    });
    And('its items are numbered 1, 2 and 3 with their texts', () => {
      const rows = itemRows();
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => within(row).getByTestId('live-card-item-text').textContent)).toEqual(['1. VERIFIED on mw-a.1', '2. VERIFIED on mw-b.1', '3. VERIFIED on mw-c.1']);
    });
    And('item 2 links to bead {string}', (_c, bead: string) => {
      const link = within(itemRows()[1]).getByRole('link', { name: `Title of ${bead}` });
      expect(link).toHaveAttribute('href', `?v=bead&id=${bead}`);
    });
  });

  Scenario('mw-debsil.1: a web address and a bead id in an item are links as in a message', ({ Given, Then, And }) => {
    Given('Needs you is open and the Mayor has sent a card titled {string} with an item {string}', async (_c, title: string, text: string) => {
      await storeView(['mw-gq6.222']);
      const body = { title, items: [{ n: 1, text, links: [] }], subscribe: { kinds: ['bead_changed'], beads: [] } };
      await sync([sealed('card', body)]);
      render(<NeedsScreen />);
      await screen.findByRole('article', { name: `Card: ${title}` });
    });
    Then('item 1 has a link to {string} that opens in a new tab', (_c, url: string) => {
      const link = within(itemRows()[0]).getByRole('link', { name: url });
      expect(link).toHaveAttribute('href', url);
      expect(link).toHaveAttribute('target', '_blank');
    });
    And('item 1 has a link to bead {string} in the app', (_c, bead: string) => {
      const link = within(itemRows()[0]).getByRole('link', { name: bead });
      expect(link).toHaveAttribute('href', `?v=bead&id=${bead}`);
      expect(link).not.toHaveAttribute('target');
    });
  });

  Scenario('mw-nqur1n.11: a bead event for an item\'s expected state ticks it with the time and fetches nothing', ({ Given, When, Then, And }) => {
    Given(GIVEN_CARD, openWithCard);
    When('the event that bead {string} is verified arrives', async (_c, bead: string) => {
      await sync([eventsRecord([beadEvent(bead, 'landed', 'verified')])]);
    });
    Then('item 1 shows a tick and the time as HH:MM', async () => {
      await waitFor(() => expect(within(itemRows()[0]).getByRole('status').textContent).toMatch(/^Done \d{2}:\d{2}/));
      expect(itemRows()[0]).toHaveAttribute('data-done', 'true');
    });
    And('items 2 and 3 have no tick', () => {
      for (const row of itemRows().slice(1)) {
        expect(row).toHaveAttribute('data-done', 'false');
        expect(within(row).queryByRole('status')).toBeNull();
      }
    });
    And('the view was not fetched', () => {
      expect(viewFetches).toBe(0);
    });
  });

  Scenario('mw-nqur1n.11: an event for another state of the bead ticks nothing', ({ Given, When, Then }) => {
    Given(GIVEN_CARD, openWithCard);
    When('the event that bead {string} is claimed arrives', async (_c, bead: string) => {
      await sync([eventsRecord([beadEvent(bead, 'open', 'claimed')])]);
    });
    Then('no item shows a tick', async () => {
      // The event has been held and applied; give the card a moment to (not) react.
      await waitFor(async () => expect(await db.events.count()).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const row of itemRows()) expect(row).toHaveAttribute('data-done', 'false');
    });
  });

  Scenario('mw-nqur1n.11: a card-update adds a link to item 2 and the same card shows it', ({ Given, When, Then, And }) => {
    Given(GIVEN_CARD, openWithCard);
    When('the Mayor sends a card-update for that card adding the link {string} to item 2', async (_c, bead: string) => {
      await sync([sealed('card-update', { re: cardTxid, links: { 2: [bead] } })]);
    });
    Then('item 2 links to bead {string} and to bead {string}', async (_c, first: string, second: string) => {
      await waitFor(() => expect(within(within(itemRows()[1]).getByRole('list', { name: 'Links for item 2' })).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([`?v=bead&id=${first}`, `?v=bead&id=${second}`]));
    });
    And('there is still one card {string} in the You list', (_c, title: string) => {
      expect(screen.getAllByRole('article', { name: `Card: ${title}` })).toHaveLength(1);
    });
    And('the view was not fetched', () => {
      expect(viewFetches).toBe(0);
    });
  });

  Scenario('mw-nqur1n.11: a card-update adds a new item to the same card', ({ Given, When, Then }) => {
    Given(GIVEN_CARD, openWithCard);
    When('the Mayor sends a card-update for that card adding item 4 {string} on bead {string}', async (_c, text: string, bead: string) => {
      await sync([sealed('card-update', { re: cardTxid, items: [{ n: 4, text, links: [bead] }] })]);
    });
    Then('the card {string} has four items and the fourth reads {string}', async (_c, _title: string, text: string) => {
      await waitFor(() => expect(itemRows()).toHaveLength(4));
      expect(itemRows()[3].textContent).toContain(text);
      expect(screen.getAllByRole('article', { name: 'Card: Top 5' })).toHaveLength(1);
    });
  });

  Scenario('mw-nqur1n.11: a card whose items are all done moves from You to Done', ({ Given, When, Then, And }) => {
    Given(GIVEN_CARD, openWithCard);
    When('the events that {string}, {string} and {string} are verified arrive', async (_c, a: string, b: string, c: string) => {
      await sync([eventsRecord([beadEvent(a, 'landed', 'verified'), beadEvent(b, 'landed', 'verified'), beadEvent(c, 'landed', 'verified')])]);
    });
    Then('the card {string} is no longer in the You list', async (_c, title: string) => {
      await waitFor(() => expect(screen.queryByRole('article', { name: `Card: ${title}` })).toBeNull());
      expect(screen.getByRole('tab', { name: /^You · 0$/ })).toBeInTheDocument();
    });
    And('a Done section reads {string} and lists the card {string}', async (_c, label: string, title: string) => {
      const toggle = screen.getByRole('button', { name: label });
      await userEvent.click(toggle);
      const section = screen.getByRole('region', { name: 'Done cards' });
      expect(within(section).getByRole('article', { name: `Card: ${title}` })).toBeInTheDocument();
      expect(within(section).getAllByTestId('live-card-item').every((row) => row.getAttribute('data-done') === 'true')).toBe(true);
    });
  });

  Scenario('mw-nqur1n.11: a card shows in the thread it was sent to', ({ Given, When, Then, And }) => {
    Given('the Mayor has sent a card titled {string} to the thread of bead {string} with an item on bead {string}', async (_c, title: string, thread: string, bead: string) => {
      await storeView([thread, bead]);
      await sendCard(title, [bead], thread);
    });
    When("the bead's channel opens", async () => {
      window.history.replaceState(null, '', '/?v=talk&t=bead%3Amw-t.1');
      render(<TalkScreen thread="bead:mw-t.1" />);
      await screen.findByTestId('thread-cards');
    });
    Then('the channel shows the card {string} with its item', (_c, title: string) => {
      const shown = within(screen.getByTestId('thread-cards')).getByRole('article', { name: `Card: ${title}` });
      expect(within(shown).getAllByTestId('live-card-item')).toHaveLength(1);
    });
    And('the card is not shown as a message', () => {
      expect(screen.queryAllByTestId('message')).toHaveLength(0);
    });
  });
});
