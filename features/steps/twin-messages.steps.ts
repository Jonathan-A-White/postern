// features/steps/twin-messages.steps.ts — runs features/twin-messages.feature (mw-f758y.40): the real message
// sync, the real chain read and the real Dexie store; only the backend and WhatsOnChain are doubles.
import { afterAll, expect } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { syncMessages } from '../../src/services/inbox';
import { readChain } from '../../src/services/chainRead';
import { encryptMessage, type MessagePayload } from '../../src/services/messages';
import { encodeThreadedMessage } from '../../src/services/threads';
import { mergeConversation } from '../../src/model/conversation';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';
import { fakeAnchorChain, publicKeyOf, transactionOfPayload } from '../../tests/support/chain-record';

const PHONE_HEX = '44'.repeat(32);
const MAYOR_HEX = '55'.repeat(32);
const PHONE_PUB = publicKeyOf(PHONE_HEX);
const MAYOR_PUB = publicKeyOf(MAYOR_HEX);
const KEY = new Uint8Array(Utils.toArray(PrivateKey.fromHex(PHONE_HEX).toHex(), 'hex'));
const BEAD = 'mw-nm.1';
const DIRECT = `direct:${'ab'.repeat(32)}`;

let payload: MessagePayload;

async function fresh(): Promise<void> {
  await Promise.all([db.settings.clear(), db.messages.clear()]);
}

function answerOnBothChannels(): void {
  payload = encryptMessage({ text: encodeThreadedMessage({ text: 'Landed.', thread: { bead: BEAD } }), class: 'message', senderPrivateKeyHex: MAYOR_HEX, recipientPublicKeyHex: PHONE_PUB, ts: 1_790_000_000 });
}

async function syncBackend(): Promise<void> {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> =>
    isChallengeRequest(String(input))
      ? challengeResponse()
      : new Response(JSON.stringify({ records: [{ seq: 1, txid: DIRECT, vout: 0, payload }], next: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await syncMessages({ publicKeyHex: PHONE_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, fetchImpl });
}

async function readTheChain(): Promise<void> {
  const chain = fakeAnchorChain([transactionOfPayload(payload)]);
  await readChain({ publicKeyHex: PHONE_PUB, unlockedKey: KEY, mayorKey: MAYOR_PUB, seen: new Set(), fetchImpl: chain.fetchImpl, hexGapMs: 0 });
}

afterAll(fresh);

const feature = await loadFeature('features/twin-messages.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-f758y.40 AC-1: the direct reply and its chain copy leave one row, the direct one', ({ Given, When, Then }) => {
    Given('the Mayor answered a chain-borne post, and the answer is on the backend and on the chain', answerOnBothChannels);
    When('the phone syncs the backend and then reads the chain', async () => {
      await syncBackend();
      await readTheChain();
    });
    Then('the phone holds one message row, the direct one, on the bead', async () => {
      const rows = await messagesRepo.getAll();
      expect(rows.map((row) => row.txid)).toEqual([DIRECT]);
      expect(rows[0].thread).toBe(`bead:${BEAD}`);
    });
  });

  Scenario('mw-f758y.40 AC-2: the conversation shows one bubble for the pair', ({ Given, When, Then }) => {
    Given('the Mayor answered a chain-borne post, and the answer is on the backend and on the chain', answerOnBothChannels);
    When('the phone reads the chain and then syncs the backend', async () => {
      await readTheChain();
      await syncBackend();
    });
    Then("the bead's conversation shows the answer once", async () => {
      const items = mergeConversation(await messagesRepo.inThread(`bead:${BEAD}`));
      expect(items).toHaveLength(1);
      expect(items[0].txid).toBe(DIRECT);
    });
  });
});
