// features/steps/long-message.steps.ts — runs features/long-message.feature (mw-fjpe9tx): the real sender, deliver,
// Dexie, the conversation merge and spell-forge-bsv (its encoder watched) against a backend double that opens each
// record as the Mayor's host does.
import { afterAll, expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LockingScript, PrivateKey, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { outboxRepo } from '../../src/data/repositories';
import { enqueue, forgetOutboxState, kickOutbox, settledOutbox } from '../../src/services/outbox';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import { settledWrites } from '../../src/services/deliver';
import { mergeConversation } from '../../src/model/conversation';
import { settlePhone } from '../../tests/support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../../tests/support/challenge-fetch';

const encoded = vi.hoisted(() => ({ sizes: [] as number[], thrown: [] as string[] }));
vi.mock('spell-forge-bsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('spell-forge-bsv')>();
  return {
    ...actual,
    encodeRecordScript: (bytes: number[]) => {
      encoded.sizes.push(bytes.length);
      try {
        return actual.encodeRecordScript(bytes);
      } catch (err) {
        encoded.thrown.push(String(err));
        throw err;
      }
    },
  };
});

const KEY = new Uint8Array(Utils.toArray('45'.repeat(32), 'hex'));
const MAYOR_PRIVATE = '77'.repeat(32);
const MAYOR = PrivateKey.fromHex(MAYOR_PRIVATE).toPublicKey().toString();

const backend = vi.hoisted(() => ({ taken: [] as { txid: string; plaintext: string }[] }));

function backendFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (isChallengeRequest(url)) return challengeResponse();
    if (!url.endsWith('/messages')) throw new Error(`unexpected fetch: ${url}`);
    const body = JSON.parse(String(init?.body)) as { scriptHex: string };
    const decoded = decodeRecordScript(LockingScript.fromHex(body.scriptHex));
    if (!decoded) throw new Error('not a record script');
    const payload = JSON.parse(Utils.toUTF8(decoded.payloadBytes)) as MessagePayload;
    const txid = `direct:${String(backend.taken.length + 1).padStart(64, '0')}`;
    backend.taken.push({ txid, plaintext: decryptMessage(payload, MAYOR_PRIVATE) });
    return new Response(JSON.stringify({ txid, seq: backend.taken.length }), { status: 201 });
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

/** His words: about `bytes` of them, in paragraphs, with a few that are not ASCII. */
function words(bytes: number): string {
  const paragraph = 'Here is what I think about the factory’s next week — the order of the stories, and why.\n\n';
  let text = '';
  while (Utils.toArray(text, 'utf8').length < bytes) text += paragraph;
  return text;
}

let his = '';

async function fresh(): Promise<void> {
  await settlePhone();
  forgetOutboxState();
  encoded.sizes.length = 0;
  encoded.thrown.length = 0;
  backend.taken = [];
  his = '';
  await Promise.all([db.messages.clear(), db.outbox.clear()]);
}

const wake = async () => {
  kickOutbox(true);
  await settledOutbox();
  await settledWrites();
};

/** The records the backend took, joined as the Mayor's host joins them: in `part` order. */
function joinedText(): string {
  const bodies = backend.taken.map((record) => JSON.parse(record.plaintext) as { text: string; part: number });
  return bodies.sort((a, b) => a.part - b.part).map((body) => body.text).join('');
}

afterAll(async () => {
  forgetOutboxState();
  await settledWrites();
});

const feature = await loadFeature('features/long-message.feature');

describeFeature(feature, ({ Scenario, BeforeEachScenario }) => {
  BeforeEachScenario(fresh);

  const answering = () => {
    backend.taken = [];
  };
  const sends = async (_c: unknown, bytes: number, topic: string) => {
    his = words(bytes);
    await enqueue({ kind: 'message', payload: { text: his, files: [], thread: { topic } }, thread: `topic:${topic}` });
    await settledOutbox();
  };
  const sent = async () => {
    expect((await outboxRepo.all())[0]).toMatchObject({ state: 'sent', txid: backend.taken[0].txid });
  };

  Scenario('mw-fjpe9tx AC2: a message of 16,000 bytes goes as several records, each within the cap, his words whole', ({ Given, When, And, Then }) => {
    Given('the backend answers every post', answering);
    When('he sends a message of {int} bytes to the thread {string}', sends);
    And('the sender is woken', wake);
    Then('the backend took more than {int} record', (_c, n: number) => {
      expect(backend.taken.length).toBeGreaterThan(n);
    });
    And('no record\'s payload was over {int} bytes', (_c, cap: number) => {
      expect(encoded.thrown).toEqual([]);
      expect(Math.max(...encoded.sizes)).toBeLessThanOrEqual(cap);
    });
    And('the records joined are his words', () => {
      expect(joinedText()).toBe(his);
    });
    And('the outbox row is sent', sent);
  });

  Scenario('mw-fjpe9tx AC3: a row 0.8.57 queued over the cap goes on its next try', ({ Given, When, And, Then }) => {
    Given('the backend answers every post', answering);
    And('his outbox holds a message of {int} bytes that read {string}', async (_c, bytes: number, reason: string) => {
      his = words(bytes);
      await db.outbox.add({ kind: 'message', bead: '', payload: { text: his, files: [] }, created: Date.now() - 3600_000, attempts: 7, nextAt: Date.now() + 58_000, state: 'pending', clientId: 'cd'.repeat(16), note: reason, error: { message: reason, at: Date.now() - 2000, attempt: 7 } });
    });
    When('the sender is woken', wake);
    Then('no try threw {string}', (_c, words: string) => {
      expect(encoded.thrown.filter((thrown) => thrown.includes(words))).toEqual([]);
      expect(encoded.sizes.length).toBeGreaterThan(0);
    });
    And('the records joined are his words', () => {
      expect(joinedText()).toBe(his);
    });
    And('the outbox row is sent', sent);
  });

  Scenario('mw-fjpe9tx AC4: the thread shows the message in parts as one message, its words whole', ({ Given, When, And, Then }) => {
    Given('the backend answers every post', answering);
    When('he sends a message of {int} bytes to the thread {string}', sends);
    And('the sender is woken', wake);
    Then('the thread {string} shows {int} message', async (_c, topic: string, n: number) => {
      const rows = await db.messages.where('thread').equals(`topic:${topic}`).toArray();
      expect(rows.length).toBeGreaterThan(1);
      expect(mergeConversation(rows)).toHaveLength(n);
    });
    And('that message\'s text is his words', async () => {
      const rows = await db.messages.where('thread').equals('topic:week').toArray();
      expect(mergeConversation(rows)[0]).toMatchObject({ kind: 'text', text: his, speaker: 'you' });
    });
  });

  Scenario('mw-fjpe9tx sweep: a To do edit too long for one record is refused on the phone in plain words, not tried every minute', ({ Given, When, And, Then }) => {
    Given('the backend answers every post', answering);
    When('he saves notes of {int} bytes on the To do card {string}', async (_c, bytes: number, bead: string) => {
      await enqueue({ kind: 'action', bead, payload: { action: { action: 'todo_edit', bead, notes: words(bytes) } } });
      await settledOutbox();
    });
    And('the sender is woken', wake);
    Then('the outbox row is failed with {string}', async (_c, start: string) => {
      const row = (await outboxRepo.all())[0];
      expect(row.state).toBe('failed');
      expect(row.failure).toContain(start);
    });
    And('no record\'s payload was over {int} bytes', (_c, cap: number) => {
      expect(encoded.thrown).toEqual([]);
      expect(encoded.sizes.every((size) => size <= cap)).toBe(true);
    });
    And('the backend took {int} records', (_c, n: number) => {
      expect(backend.taken).toHaveLength(n);
    });
  });
});
