// features/steps/events-projection.steps.tsx — runs features/events-projection.feature
// (mw-jrx0s.7): the real message sync pages sealed `events` records (docs/protocol.md
// §22) and projects them onto the stored view; only the backend is a fetch double, and
// it counts every GET /api/view so a scenario can say the view was not fetched again.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { NeedsScreen } from '../../src/cockpit/NeedsScreen';
import { db } from '../../src/data/db';
import { eventsRepo, viewRepo } from '../../src/data/repositories';
import { sealDocument } from '../../src/services/documents';
import { syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage } from '../../src/services/messages';
import { encodeReply } from '../../src/services/questions';
import { decodeView, type Need, type View, type ViewBead } from '../../src/model/view';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { freezeClock, thawClock } from '../../tests/support/freeze-clock';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

configure({ asyncUtilTimeout: 5000 });

const GOV = PrivateKey.fromHex('44'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const BEAD = 'mw-ev.1';
const WRITTEN = '2026-10-01T12:00:00Z';
const ANSWER_TXID = 'ab'.repeat(32);

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

let page: ApiRecord[] = [];
let viewFetches = 0;
let recordSeq = 0;

function viewBead(id: string, status: string): ViewBead {
  return { id, title: 'Paint the door', type: 'task', status, priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

function viewWith(status: string, needs: Need[] = []): View {
  return { ...fixtureView(Date.parse(WRITTEN)), written_at: WRITTEN, needs, beads: [viewBead(BEAD, status)] };
}

async function storeView(view: View): Promise<void> {
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, etag: '"first"', source: 'live', fetchedAt: Date.parse(WRITTEN) });
}

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function stateEvent(seq: number, from: string, to: string) {
  return { seq, ts: '2026-10-01T12:01:00Z', kind: 'bead_changed', bead: BEAD, actor: 'mw@laptop', from, to, detail: 'status', lane: 'normal' };
}

function batchRecord(events: Array<{ seq: number }>): ApiRecord {
  const batch = { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events };
  return record(encryptMessage({ text: JSON.stringify(batch), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
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
    const sealed = await sealDocument(JSON.stringify({ ...viewWith('in_progress'), written_at: '2026-10-01T12:05:00Z' }), MAYOR.toHex(), GOV_PUB);
    return new Response(sealed, { status: 200, headers: { ETag: '"second"' } });
  }
  return new Response('not found', { status: 404 });
};

async function sync(records: ApiRecord[]): Promise<void> {
  page = records;
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

async function storedStatus(): Promise<string | undefined> {
  const row = await viewRepo.get();
  return row ? decodeView(row.plaintext).beads.find((bead) => bead.id === BEAD)?.status : undefined;
}

async function fresh(): Promise<void> {
  freezeClock();
  cleanup();
  page = [];
  viewFetches = 0;
  recordSeq = 0;
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear()]);
  window.history.replaceState(null, '', '/?v=needs');
}

afterAll(() => {
  thawClock();
  cleanup();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/events-projection.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario, AfterEachScenario }) => {
  BeforeEachScenario(fresh);
  AfterEachScenario(thawClock);

  const viewAndCursor = async (_c: unknown, _bead: string, cursor: number) => {
    await storeView(viewWith('open'));
    await eventsRepo.setCursor(cursor);
  };

  Scenario('mw-jrx0s.7: a batch applies in seq order', ({ Given, When, Then, And }) => {
    Given('a stored view where {string} is open and the events cursor is at {int}', viewAndCursor);
    When('one sync pages the batch for seq 2 before the batch for seq 1', async () => {
      const second = batchRecord([stateEvent(2, 'claimed', 'open')]);
      const first = batchRecord([stateEvent(1, 'open', 'claimed')]);
      await sync([second, first]);
    });
    Then('{string} reads {string} in the stored view, as seq 2 left it', async (_c, _bead: string, status: string) => {
      expect(await storedStatus()).toBe(status);
    });
    And('the events cursor is at {int}', async (_c, cursor: number) => {
      expect(await eventsRepo.cursor()).toBe(cursor);
    });
    And('the view was not fetched again', () => {
      expect(viewFetches).toBe(0);
    });
  });

  Scenario('mw-jrx0s.7: a gap in the seqs fetches the view again and goes on', ({ Given, When, Then, And }) => {
    Given('a stored view where {string} is open and the events cursor is at {int}', viewAndCursor);
    When('a sync pages a batch that starts at seq 7', async () => {
      await sync([batchRecord([stateEvent(7, 'open', 'claimed')])]);
    });
    Then('the view is fetched again from the backend', async () => {
      expect(viewFetches).toBe(1);
      expect((await viewRepo.get())?.written_at).toBe('2026-10-01T12:05:00Z');
    });
    And('the cursor reads {int}', async (_c, cursor: number) => {
      expect(await eventsRepo.cursor()).toBe(cursor);
    });
    And('a later batch for seq 8 applies without fetching the view', async () => {
      await sync([batchRecord([stateEvent(8, 'claimed', 'open')])]);
      expect(viewFetches).toBe(1);
      expect(await storedStatus()).toBe('open');
      expect(await eventsRepo.cursor()).toBe(8);
    });
  });

  Scenario('mw-jrx0s.7: Needs you shows a card answered without a refetch', ({ Given, When, Then, And }) => {
    Given('Needs you is open on the question {string} on {string} with the options {string} and {string}', async (_c, q: string, bead: string, a: string, b: string) => {
      const question: Need = { kind: 'question', bead, epic: '', title: 'Paint the door', since: '2026-10-01T11:00:00Z', text: q, recommended: '', options: [a, b], blocks: 0, steps: [], waits_for: 'you' };
      await storeView(viewWith('open', [question]));
      render(<NeedsScreen />);
      await screen.findByRole('button', { name: a });
    });
    When('a sync pages his answer {string} and the event that the card on {string} was answered', async (_c, answer: string, bead: string) => {
      const reply = { ...record(encryptMessage({ text: encodeReply({ bead, answer }), class: 'message', senderPrivateKeyHex: GOV.toHex(), recipientPublicKeyHex: MAYOR_PUB })), txid: ANSWER_TXID };
      const answered = { seq: 1, ts: '2026-10-01T12:02:00Z', kind: 'card_answered', bead, actor: 'mw@laptop', from: 'asked', to: 'answered', detail: ANSWER_TXID, lane: 'normal' };
      await sync([reply, batchRecord([answered])]);
    });
    Then('the card says {string} and the time as HH:MM', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toMatch(new RegExp(`${line} \\d{2}:\\d{2}`)));
    });
    And('its options are disabled', async () => {
      await waitFor(() => {
        const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeDisabled();
      });
    });
    And('the view was never fetched', async () => {
      expect(viewFetches).toBe(0);
      const row = await viewRepo.get();
      expect(row?.written_at).toBe(WRITTEN);
      expect(row?.fetchedAt).toBe(Date.parse(WRITTEN));
    });
  });
});
