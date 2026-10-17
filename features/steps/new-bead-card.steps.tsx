// features/steps/new-bead-card.steps.tsx — runs features/new-bead-card.feature (mw-ev7oyy.37): the real message sync
// pages a sealed `events` record (docs/protocol.md §22) whose event names a new bead, and the card shows on the stored
// view within the minute, from that bead's small detail (§12), with no fetch of the whole view. Only the backend is a
// fetch double; it counts every GET /api/view, and the view throttle is the real one.
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { VIEW_BEHIND_INTERVAL_MS, resetViewThrottle } from '../../src/services/view';
import { viewThrottle } from '../../src/services/viewThrottle';
import { sealDocument } from '../../src/services/documents';
import { syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage } from '../../src/services/messages';
import { indexView } from '../../src/model/tree';
import { decodeView, type BeadDetail, type View, type ViewBead } from '../../src/model/view';
import { todoListsFromView } from '../../src/todo';
import { fixtureView, MAYOR } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const GOV = PrivateKey.fromHex('46'.repeat(32));
const GOV_PUB = GOV.toPublicKey().toString();
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const KEY = new Uint8Array(Utils.toArray(GOV.toHex(), 'hex'));
const LIST = 'mw-list.1';
const NEW = 'mw-list.1.9';
const WRITTEN = '2026-10-01T12:00:00Z';
const FILED = '2026-10-01T12:01:00Z';
const BODY = 'Do this: ring the surgery and book a clean. Done when: a time is in the calendar.';

interface ApiRecord {
  seq: number;
  txid: string;
  vout: number;
  payload: unknown;
}

let page: ApiRecord[] = [];
let viewFetches = 0;
let beadFetches: string[] = [];
let details = new Map<string, BeadDetail>();
let recordSeq = 0;

function viewBead(id: string, extra: Partial<ViewBead>): ViewBead {
  return { id, title: id, type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: WRITTEN, updated: WRITTEN, started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0, ...extra };
}

function storedViewValue(): View {
  return { ...fixtureView(Date.parse(WRITTEN)), written_at: WRITTEN, needs: [], beads: [viewBead(LIST, { title: 'Errands', type: 'epic', labels: ['hitl:todo'] })] };
}

function detailOf(title: string, labels: string[], parent: string): BeadDetail {
  return { v: 2, id: NEW, title, type: 'task', status: 'open', priority: 2, parent, labels, assignee: '', waits: [], blocks: [], children: [], created: FILED, updated: FILED, started: '', closed: '', attempts: 0, description: BODY, acceptance: '', comments: [] };
}

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function filedEvent() {
  return { seq: 1, ts: FILED, kind: 'bead_changed', bead: NEW, actor: 'mw@laptop', from: '', to: 'open', detail: 'created', lane: 'normal' };
}

function batchRecord(): ApiRecord {
  const batch = { from: 1, to: 1, lane: 'normal', events: [filedEvent()] };
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
  if (url.split('?')[0].endsWith('/view')) {
    viewFetches += 1;
    return new Response(await sealDocument(JSON.stringify(storedViewValue()), MAYOR.toHex(), GOV_PUB), { status: 200, headers: { ETag: '"second"' } });
  }
  const beadId = /\/beads\/([^/?]+)/.exec(url)?.[1];
  if (beadId) {
    beadFetches.push(beadId);
    const detail = details.get(beadId);
    if (detail) return new Response(await sealDocument(JSON.stringify(detail), MAYOR.toHex(), GOV_PUB), { status: 200 });
    return new Response('{"error":"no such bead"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
};

async function stored(): Promise<View> {
  const row = await viewRepo.get();
  if (!row) throw new Error('no view stored');
  return decodeView(row.plaintext);
}

async function fresh(): Promise<void> {
  page = [];
  viewFetches = 0;
  beadFetches = [];
  details = new Map();
  recordSeq = 0;
  resetViewThrottle();
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.beadDetails.clear()]);
  const view = storedViewValue();
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, etag: '"first"', source: 'live', fetchedAt: Date.now() });
  viewThrottle.lastFetchAt = performance.now(); // the whole view was fetched a moment ago, so the throttle's window is open
}

async function sync(): Promise<void> {
  page = [batchRecord()];
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

afterAll(() => {
  resetViewThrottle();
});

const feature = await loadFeature('features/new-bead-card.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('mw-ev7oyy.37: a To do filed under a list the phone holds shows on the To do board within a minute', ({ Given, When, Then, And }) => {
    Given('a stored view that holds the list "Errands" and the whole view was fetched a moment ago', fresh);
    When('a sync pages the event that a hitl:todo bead "Call the dentist" was filed under "Errands"', async () => {
      details.set(NEW, detailOf('Call the dentist', ['hitl:todo'], LIST));
      await sync();
    });
    Then('the To do board lists "Call the dentist" under "Errands"', async () => {
      const lists = todoListsFromView(indexView(await stored()), Date.parse(FILED));
      expect(lists.map((list) => [list.title, list.cards.map((card) => card.title)])).toEqual([['Errands', ['Call the dentist']]]);
    });
    And('the whole view was not fetched and none waits for its window', () => {
      expect(viewFetches).toBe(0);
      expect(viewThrottle.trailing).toBeUndefined();
    });
  });

  Scenario('mw-ev7oyy.37: a decision card filed for him shows on Needs you within a minute', ({ Given, When, Then, And }) => {
    Given('a stored view that holds the list "Errands" and the whole view was fetched a moment ago', fresh);
    When('a sync pages the event that a hitl:decision bead "Pick the paint" was filed under "Errands"', async () => {
      details.set(NEW, detailOf('Pick the paint', ['hitl', 'hitl:decision'], LIST));
      await sync();
    });
    Then('Needs you holds a decision card "Pick the paint" with its Do this and Done when', async () => {
      const cards = (await stored()).needs.filter((need) => need.kind === 'decision');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ bead: NEW, title: 'Pick the paint', epic: LIST, waits_for: 'you', not_ready: false });
      expect(cards[0].text).toContain('Do this');
      expect(cards[0].text).toContain('Done when');
    });
    And('the whole view was not fetched and none waits for its window', () => {
      expect(viewFetches).toBe(0);
      expect(viewThrottle.trailing).toBeUndefined();
    });
  });

  Scenario('mw-ev7oyy.37: a new bead the phone cannot place still waits for the fifteen-minute window', ({ Given, When, Then, And }) => {
    Given('a stored view that holds the list "Errands" and the whole view was fetched a moment ago', fresh);
    When('a sync pages the event that a bead "Mail from elsewhere" was filed under a story the phone does not hold', async () => {
      details.set(NEW, detailOf('Mail from elsewhere', [], 'mw-elsewhere'));
      await sync();
    });
    Then('the whole view was not fetched now', () => {
      expect(viewFetches).toBe(0);
    });
    And('the view is waited for until fifteen minutes after the last fetch, saying behind', () => {
      expect(viewThrottle.trailing?.options.why).toBe('behind');
      expect(viewThrottle.trailing?.due).toBeCloseTo(viewThrottle.lastFetchAt + VIEW_BEHIND_INTERVAL_MS, -2);
    });
  });
});
