// features/steps/events-screens.steps.tsx — runs features/events-screens.feature
// (mw-jrx0s.8): the bead page open on a bead, the real message sync paging sealed
// records and `events` batches (docs/protocol.md §22), and only the backend as a fetch
// double that counts every GET /api/beads/<id>, so a scenario can say the detail was not
// fetched again.
import '@testing-library/react/dont-cleanup-after-each';
import { render, screen, cleanup, within, waitFor, configure } from '@testing-library/react';
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { BeadScreen } from '../../src/cockpit/BeadScreen';
import { db } from '../../src/data/db';
import { viewRepo } from '../../src/data/repositories';
import { lock, setKey } from '../../src/services/keySession';
import { sealDocument } from '../../src/services/documents';
import { syncMessagesAndEvents } from '../../src/services/events';
import { encryptMessage } from '../../src/services/messages';
import { encodeReply } from '../../src/services/questions';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { BeadComment, BeadDetail, Need, View, ViewBead } from '../../src/model/view';
import { fixtureView, handsStep, MAYOR } from '../../tests/support/cockpit-fixture';
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
let recordSeq = 0;
let detailFetches = 0;
let serverComments: BeadComment[] = [];
let serverStatus = 'open';
let view: View;

function viewBead(): ViewBead {
  return { id: BEAD, title: 'Paint the door', type: 'task', status: 'open', priority: 2, labels: [], assignee: '', waits: [], created: '', updated: '', started: '', closed: '', attempts: 0, summary: '', comments: 0, done_earlier: 0 };
}

function serverDetail(): BeadDetail {
  return {
    v: 2,
    id: BEAD,
    title: 'Paint the door',
    type: 'task',
    status: serverStatus,
    priority: 2,
    labels: [],
    assignee: '',
    waits: [],
    blocks: [],
    children: [],
    created: '',
    updated: '',
    started: '',
    closed: '',
    attempts: 0,
    description: '',
    acceptance: '',
    comments: serverComments,
  };
}

function record(payload: unknown): ApiRecord {
  recordSeq += 1;
  return { seq: recordSeq, txid: recordSeq.toString(16).padStart(64, '0'), vout: 0, payload };
}

function batchRecord(events: Array<{ seq: number }>): ApiRecord {
  const batch = { from: events[0].seq, to: events[events.length - 1].seq, lane: 'normal', events };
  return record(encryptMessage({ text: JSON.stringify(batch), class: 'events', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
}

const event = (seq: number, kind: string, from: string, to: string, detail: string) => ({ seq, ts: '2026-10-01T12:01:00Z', kind, bead: BEAD, actor: 'mw@laptop', from, to, detail, lane: 'normal' });

const backend = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (isChallengeRequest(url)) return challengeResponse();
  if (url.includes('/messages')) {
    const records = page;
    page = [];
    return new Response(JSON.stringify({ records, next: recordSeq }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/beads/')) {
    detailFetches += 1;
    return new Response(await sealDocument(JSON.stringify(serverDetail()), MAYOR.toHex(), GOV_PUB), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};

async function sync(records: ApiRecord[]): Promise<void> {
  page = records;
  await syncMessagesAndEvents({ publicKeyHex: GOV_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: true, fetchImpl: backend });
}

async function storeView(needs: Need[] = []): Promise<void> {
  view = { ...fixtureView(Date.parse(WRITTEN)), written_at: WRITTEN, needs, beads: [{ ...viewBead(), comments: serverComments.length }] };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: WRITTEN, etag: '"first"', source: 'live', fetchedAt: Date.parse(WRITTEN) });
}

/** The page open, the key unlocked, and the mount's own fetch of the bead's detail done. */
async function openPage(): Promise<void> {
  setKey(KEY);
  render(<BeadScreen id={BEAD} />);
  await waitFor(() => expect(detailFetches).toBe(1));
  await screen.findByLabelText('Actions');
}

async function fresh(): Promise<void> {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', backend);
  page = [];
  recordSeq = 0;
  detailFetches = 0;
  serverComments = [];
  serverStatus = 'open';
  await Promise.all([db.settings.clear(), db.view.clear(), db.answers.clear(), db.messages.clear(), db.events.clear(), db.beadDetails.clear()]);
  window.history.replaceState(null, '', `/?v=bead&id=${BEAD}`);
}

afterAll(() => {
  cleanup();
  lock();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

const feature = await loadFeature('features/events-screens.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const pageOpen = async () => {
    await storeView();
    await openPage();
  };
  const detailNotFetchedAgain = () => expect(detailFetches).toBe(1);

  Scenario('mw-jrx0s.8: a message event shows in the open thread without fetching the bead\'s detail', ({ Given, When, Then, And }) => {
    Given('the page of {string} is open and its detail has been fetched once', pageOpen);
    When('a sync pages the Mayor\'s message {string} in its channel and the event for it', async (_c, text: string) => {
      const message = record(encryptMessage({ text: encodeThreadedMessage({ thread: { bead: BEAD }, text }), class: 'message', senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: GOV_PUB }));
      await sync([message, batchRecord([event(1, 'message', '', '', message.txid)])]);
    });
    Then('the thread shows {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
    And('the bead\'s detail was not fetched again', detailNotFetchedAgain);
  });

  Scenario('mw-jrx0s.8: a comment event brings the new comment into the open thread', ({ Given, When, Then }) => {
    Given('the page of {string} is open and its detail has been fetched once', pageOpen);
    When('a sync pages the event that a comment was added, and the bead now holds {string}', async (_c, text: string) => {
      serverComments = [{ at: '2026-10-01T12:01:00Z', author: 'mw@laptop', text }];
      await sync([batchRecord([event(1, 'bead_changed', 'open', 'open', 'comment')])]);
    });
    Then('the thread shows {string}', async (_c, text: string) => {
      expect(await screen.findByText(text)).toBeInTheDocument();
    });
  });

  Scenario('mw-jrx0s.8: a status event changes the status on the open page without fetching the bead\'s detail', ({ Given, When, Then, And }) => {
    Given('the page of {string} is open and its detail has been fetched once', pageOpen);
    When('a sync pages the event that the bead was claimed', async () => {
      expect(within(screen.getByLabelText('Actions')).getByRole('button', { name: 'Hold' })).toBeInTheDocument();
      await sync([batchRecord([event(1, 'bead_changed', 'open', 'claimed', 'status')])]);
    });
    Then('the page offers no Hold button', async () => {
      await waitFor(() => expect(within(screen.getByLabelText('Actions')).queryByRole('button', { name: 'Hold' })).not.toBeInTheDocument());
    });
    And('the bead\'s detail was not fetched again', detailNotFetchedAgain);
  });

  Scenario('mw-jrx0s.8: a card answered event greys the card on the bead\'s page, and still does after a reload', ({ Given, When, Then, And }) => {
    Given('the page of {string} is open on the question {string} with the options {string} and {string}', async (_c, bead: string, q: string, a: string, b: string) => {
      const question: Need = { kind: 'question', bead, epic: '', title: 'Paint the door', since: '2026-10-01T11:00:00Z', text: q, recommended: '', options: [a, b], blocks: 0, steps: [], waits_for: 'you' };
      await storeView([question]);
      await openPage();
      await screen.findByRole('button', { name: a });
    });
    When('a sync pages his answer {string} and the event that the card on {string} was answered', async (_c, answer: string, bead: string) => {
      const reply = { ...record(encryptMessage({ text: encodeReply({ bead, answer }), class: 'message', senderPrivateKeyHex: GOV.toHex(), recipientPublicKeyHex: MAYOR_PUB })), txid: ANSWER_TXID };
      await sync([reply, batchRecord([{ ...event(1, 'card_answered', 'asked', 'answered', ANSWER_TXID), ts: '2026-10-01T12:02:00Z' }])]);
    });
    Then('the card says {string} and the time as HH:MM', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toMatch(new RegExp(`${line} \\d{2}:\\d{2}`)));
    });
    And('the card\'s options are disabled', async () => {
      await waitFor(() => {
        const buttons = within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button');
        expect(buttons).toHaveLength(2);
        for (const button of buttons) expect(button).toBeDisabled();
      });
    });
    When('the page is opened again', async () => {
      cleanup();
      await db.answers.clear();
      render(<BeadScreen id={BEAD} />);
      await screen.findByLabelText('Actions');
    });
    Then('the card still says {string} and the time as HH:MM', async (_c, line: string) => {
      await waitFor(() => expect(screen.getByTestId('need-card').textContent).toMatch(new RegExp(`${line} \\d{2}:\\d{2}`)));
    });
    And('the card\'s options are still disabled', async () => {
      await waitFor(() => {
        for (const button of within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')) expect(button).toBeDisabled();
      });
    });
  });

  Scenario('mw-jrx0s.8: a RAN event shows the step\'s line under its comment', ({ Given, When, Then }) => {
    const step = handsStep(BEAD, { id: 'step-1', host: 'laptop', as: 'user', run: 'echo hi', way_back: '' });
    const asked = { at: '2026-10-01T11:30:00Z', author: 'mw', text: `HANDS STEP ${step.id} on laptop as user:\n\`\`\`sh\necho hi\n\`\`\`` };
    Given('the page of {string} is open on a hands step {string} not yet run', async () => {
      serverComments = [asked];
      const need: Need = { kind: 'hands', bead: BEAD, epic: '', title: 'Run it', since: '2026-10-01T11:30:00Z', text: '', recommended: '', options: [], blocks: 0, steps: [step], waits_for: 'you' };
      await storeView([need]);
      await openPage();
      await screen.findByLabelText('Run step-1');
    });
    When('a sync pages the event that step {string} ran and the bead now holds its RAN comment', async () => {
      serverComments = [asked, { at: '2026-10-01T12:01:00Z', author: 'mw', text: 'RAN step step-1 on laptop as user, exit 0' }];
      await sync([batchRecord([{ ...event(1, 'hands_ran', '', '', 'step-1') }])]);
    });
    Then('the step\'s comment says it ran, exit 0', async () => {
      await waitFor(() => expect(screen.getByText(/Ran .*exit 0/)).toBeInTheDocument());
    });
  });
});
