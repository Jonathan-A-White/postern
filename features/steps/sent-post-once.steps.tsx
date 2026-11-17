// features/steps/sent-post-once.steps.tsx — runs features/sent-post-once.feature (mw-pz7275r): the real sender and the
// real deliver() against a backend double that, as the live stream does, puts the post's own record on the phone
// BEFORE its reply to the post arrives. The thread is what Talk and a bead page build it from: mergeConversation of
// the kept records plus pendingMessageItems of the outbox.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { Hash, PrivateKey, Utils } from '@bsv/sdk';
import { db } from '../../src/data/db';
import type { ConversationItem } from '../../src/model/conversation';
import { mergeConversation } from '../../src/model/conversation';
import { pendingMessageItems } from '../../src/model/outbox';
import { enqueue, forgetOutboxState, settledOutbox } from '../../src/services/outbox';
import { encodeThreadedMessage } from '../../src/services/threads';
import { settlePhone } from '../../tests/support/empty-phone';
import { settledWrites } from '../../src/services/deliver';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR = PrivateKey.fromHex('77'.repeat(32)).toPublicKey().toString();

/** What the thread shows now, built the way a screen builds it. */
async function bubbles(): Promise<ConversationItem[]> {
  const rows = await db.messages.toArray();
  const outbox = await db.outbox.toArray();
  return [...mergeConversation(rows, []), ...pendingMessageItems(outbox, rows, (thread) => thread === undefined)];
}

const seen = vi.hoisted(() => ({ during: [] as string[][], echoed: false }));

/** The backend: the record is stored and streamed to the phone first, the reply to the post comes after. */
function backendFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (!url.endsWith('/messages')) throw new Error(`unexpected fetch: ${url}`);
    const { scriptHex } = JSON.parse(String(init?.body)) as { scriptHex: string };
    const txid = `direct:${Utils.toHex(Hash.sha256(Utils.toArray(scriptHex, 'hex')))}`;
    await db.messages.put({
      id: `${txid}:0`,
      txid,
      vout: 0,
      seq: 7,
      class: 'message',
      to: 't',
      from: 'f',
      ts: Math.floor(Date.now() / 1000),
      ciphertext: '',
      plaintext: encodeThreadedMessage({ text: 'test' }),
      direction: 'sent',
      read: true,
    });
    seen.echoed = true;
    seen.during.push((await bubbles()).map((item) => item.id));
    return new Response(JSON.stringify({ txid, seq: 7 }), { status: 201 });
  }) as unknown as typeof fetch;
}

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: KEY, mayorKey: MAYOR, direct: true, fetchImpl: backendFetch() }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => KEY,
}));

let before: ConversationItem[] = [];

async function fresh(): Promise<void> {
  await settlePhone();
  forgetOutboxState();
  seen.during = [];
  seen.echoed = false;
  await Promise.all([db.messages.clear(), db.outbox.clear()]);
}

afterAll(async () => {
  forgetOutboxState();
  await settledWrites();
});

const feature = await loadFeature('features/sent-post-once.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  Scenario('mw-pz7275r: its own echo arriving before the backend\'s reply leaves one bubble, not two', ({ Given, When, Then, And }) => {
    Given('the backend sends the record back to the phone before it answers the post', () => {
      expect(seen.echoed).toBe(false);
    });
    When('he sends {string} in the general thread', async (_c, text: string) => {
      await enqueue({ kind: 'message', bead: '', payload: { text, files: [] } });
      before = await bubbles();
      await settledOutbox();
      await settledWrites();
    });
    Then('the thread showed one bubble before the post, while the record was kept and after the reply', async () => {
      expect(before).toHaveLength(1);
      expect(before[0].pending).toBe(true);
      expect(seen.echoed).toBe(true);
      expect(seen.during).toHaveLength(1);
      expect(seen.during[0]).toHaveLength(1);
      expect(await bubbles()).toHaveLength(1);
    });
    And('the bubble at the end is his own post, no longer pending', async () => {
      const [item] = await bubbles();
      expect(item).toMatchObject({ speaker: 'you', text: 'test' });
      expect(item.pending).toBeFalsy();
    });
  });
});
