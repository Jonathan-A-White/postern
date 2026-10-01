// features/steps/events-not-messages.steps.ts — runs features/events-not-messages.feature (mw-jrx0s.22):
// the real message sync (the backend feed, which the stream's `message` event pulls), the real chain read
// and the real Dexie store; only the backend and WhatsOnChain are doubles. "Factory and the bead channel"
// are the lists the cockpit's hooks read (hooks.ts: getAllOldestFirst and inThread).
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db, type MessageRow } from '../../src/data/db';
import { eventsRepo, messagesRepo, viewRepo } from '../../src/data/repositories';
import { projectBatches, syncMessagesAndEvents } from '../../src/services/events';
import { readChain } from '../../src/services/chainRead';
import { encryptMessage } from '../../src/services/messages';
import { fixtureView } from '../../tests/support/cockpit-fixture';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { fakeAnchorChain, publicKeyOf, recordTransaction } from '../../tests/support/chain-record';

const PHONE_HEX = '44'.repeat(32);
const MAYOR_HEX = '55'.repeat(32);
const PHONE_PUB = publicKeyOf(PHONE_HEX);
const MAYOR_PUB = publicKeyOf(MAYOR_HEX);
const KEY = new Uint8Array(Utils.toArray(PrivateKey.fromHex(PHONE_HEX).toHex(), 'hex'));
const BEAD = 'mw-nm.1';

const batch = { from: 1, to: 1, lane: 'normal', events: [{ seq: 1, ts: '2026-10-01T16:14:05Z', kind: 'bead_changed', bead: BEAD, actor: 'root', from: 'held', to: 'open', detail: 'status', lane: 'normal' }] };

function stored(id: string, cls: MessageRow['class'], ts: number, thread?: string): MessageRow {
  return { id, txid: id, vout: 0, seq: ts, class: cls, to: PHONE_PUB, from: MAYOR_PUB, ts, ciphertext: 'ct', plaintext: cls === 'events' ? JSON.stringify(batch) : 'Back now.', direction: 'received', read: false, thread };
}

async function fresh(): Promise<void> {
  await Promise.all([db.settings.clear(), db.view.clear(), db.messages.clear(), db.events.clear()]);
}

async function holdOneMessage(): Promise<void> {
  const now = Date.parse('2026-10-01T16:00:00Z');
  const view = { ...fixtureView(now), written_at: '2026-10-01T16:00:00Z' };
  await viewRepo.save({ plaintext: JSON.stringify(view), written_at: view.written_at, source: 'live', fetchedAt: now });
  await eventsRepo.setCursor(0);
  await messagesRepo.put(stored('real:0', 'message', 10));
}

async function onlyTheRealMessage(): Promise<void> {
  expect((await messagesRepo.getAllOldestFirst()).map((row) => row.id)).toEqual(['real:0']);
  expect(await messagesRepo.inThread(BEAD)).toEqual([]);
  expect(await db.messages.count()).toBe(1);
}

async function projected(): Promise<void> {
  expect((await eventsRepo.after(0)).map((event) => event.seq)).toEqual([1]);
}

afterAll(fresh);

const feature = await loadFeature('features/events-not-messages.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-jrx0s.22 AC-1: an events record that comes by the backend feed is projected and makes no message', ({ Given, When, Then, And }) => {
    Given('the phone holds one real message and the events cursor is at 0', holdOneMessage);
    When('the backend feed, which the stream\'s message event pulls, brings an events record', async () => {
      const payload = encryptMessage({ text: JSON.stringify(batch), class: 'events', senderPrivateKeyHex: MAYOR_HEX, recipientPublicKeyHex: PHONE_PUB });
      const fetchImpl = async (input: RequestInfo | URL): Promise<Response> =>
        isChallengeRequest(String(input))
          ? challengeResponse()
          : new Response(JSON.stringify({ records: [{ seq: 1, txid: `direct:${'ab'.repeat(32)}`, vout: 0, payload }], next: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      await syncMessagesAndEvents({ publicKeyHex: PHONE_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, live: false, fetchImpl });
    });
    Then('the event is projected', projected);
    And('Factory and the bead channel show only the real message', onlyTheRealMessage);
  });

  Scenario('mw-jrx0s.22 AC-2: an events record read from the chain is projected and makes no message', ({ Given, When, Then, And }) => {
    Given('the phone holds one real message and the events cursor is at 0', holdOneMessage);
    When('an events transaction is on the anchor address and the phone reads the chain', async () => {
      const tx = recordTransaction({ senderHex: MAYOR_HEX, recipientPublicKeyHex: PHONE_PUB, class: 'events', plaintext: JSON.stringify(batch), ts: 1_790_000_000 });
      const read = await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: fakeAnchorChain([tx]).fetchImpl, hexGapMs: 0 });
      expect(read.rows).toEqual([]);
      await projectBatches(read.events);
    });
    Then('the event is projected', projected);
    And('Factory and the bead channel show only the real message', onlyTheRealMessage);
  });

  Scenario('mw-jrx0s.22 AC-3: a message row stored from an events record is removed when the app opens', ({ Given, When, Then, And }) => {
    Given('the phone holds one real message and a row an older build stored from an events record', async () => {
      await holdOneMessage();
      await db.messages.put(stored(`direct:${'cd'.repeat(32)}:0`, 'events', 20));
      await db.messages.put(stored(`direct:${'ef'.repeat(32)}:0`, 'events', 21, BEAD));
    });
    When('the app opens', async () => {
      db.close();
      await db.open();
    });
    Then('the stored events row is gone', async () => {
      expect((await db.messages.toArray()).filter((row) => row.class === 'events')).toEqual([]);
    });
    And('Factory and the bead channel show only the real message', onlyTheRealMessage);
  });
});
