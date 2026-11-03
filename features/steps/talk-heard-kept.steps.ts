// features/steps/talk-heard-kept.steps.ts — runs features/talk-heard-kept.feature (mw-gq6.912): the real record store
// and the real Dexie store. The one double is a Stop that lands between the store reading its row and writing it back.
import { afterAll, afterEach, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { PrivateKey } from '@bsv/sdk';
import Dexie from 'dexie';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { storeRecord } from '../../src/services/inbox';
import { encryptMessage, type MessagePayload } from '../../src/services/messages';
import { encodeTurn } from '../../src/services/talk';

const PHONE = PrivateKey.fromHex('44'.repeat(32));
const MAYOR = PrivateKey.fromHex('55'.repeat(32));
const PHONE_PUB = PHONE.toPublicKey().toString();
const TXID = 'direct:' + 'ab'.repeat(32);
const ROW = `${TXID}:0`;

let payload: MessagePayload;
let stopped: Promise<void> | undefined;

const store = () => storeRecord({ seq: 3, txid: TXID, vout: 0, payload }, PHONE_PUB, PHONE.toHex());

async function fresh(): Promise<void> {
  vi.restoreAllMocks();
  stopped = undefined;
  await db.messages.clear();
}

afterEach(() => vi.restoreAllMocks());
afterAll(fresh);

const feature = await loadFeature('features/talk-heard-kept.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const unheardAnswer = async () => {
    payload = encryptMessage({
      text: encodeTurn({ talk: { id: 't1', turn: 1 }, text: 'Three things landed.', role: 'answer' }),
      class: 'talk',
      senderPrivateKeyHex: MAYOR.toHex(),
      recipientPublicKeyHex: PHONE_PUB,
      ts: 1_790_000_000,
    });
    await store();
    expect((await messagesRepo.get(ROW))?.heard).toBe(false);
  };
  const markedHeard = async () => {
    await stopped;
    expect((await messagesRepo.get(ROW))?.heard).toBe(true);
  };

  Scenario('mw-gq6.912: a Stop that lands while the answer\'s record is being stored again is not lost', ({ Given, When, Then }) => {
    Given("the Mayor's talk answer is on the phone and he has not heard it", unheardAnswer);
    When('the phone stores the same record again and he stops the answer while that is being stored', async () => {
      const write = messagesRepo.put.bind(messagesRepo);
      // his Stop is its own write, started the moment the store has read the row and is about to write it back
      vi.spyOn(messagesRepo, 'put').mockImplementation((row) => {
        stopped = Dexie.ignoreTransaction(() => messagesRepo.markHeard(ROW));
        return write(row);
      });
      await store();
    });
    Then('the stored answer is marked heard', markedHeard);
  });

  Scenario('mw-gq6.912: an answer stored again after he heard it stays heard', ({ Given, And, When, Then }) => {
    Given("the Mayor's talk answer is on the phone and he has not heard it", unheardAnswer);
    And('he stopped the answer', () => messagesRepo.markHeard(ROW));
    When('the phone stores the same record again', async () => {
      await store();
    });
    Then('the stored answer is marked heard', markedHeard);
  });
});
