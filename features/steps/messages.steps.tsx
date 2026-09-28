// features/steps/messages.steps.tsx — runs features/messages.feature: the §1
// envelope and its BRC-78 encryption, direct delivery (plans/0021, §9) with the
// funded-transaction fallback for an old backend, and syncing what the backend
// holds into the phone's store under the right thread.
import { expect, vi } from 'vitest';
import { loadFeature, describeFeature } from '@amiceli/vitest-cucumber';
import { LockingScript, PrivateKey, Transaction, Utils } from '@bsv/sdk';
import { decodeRecordScript } from 'spell-forge-bsv';
import { db } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { decryptMessage, encryptMessage, type MessagePayload } from '../../src/services/messages';
import { deliver, deliverThreaded } from '../../src/services/deliver';
import { syncMessages } from '../../src/services/inbox';
import { encodeQuestion } from '../../src/services/questions';
import { encodeThreadedMessage, threadKey } from '../../src/services/threads';

const MAYOR = PrivateKey.fromHex('11'.repeat(32));
const HIM = PrivateKey.fromHex('22'.repeat(32));
const SOMEONE = PrivateKey.fromHex('33'.repeat(32));
const HIM_KEY = new Uint8Array(Utils.toArray(HIM.toHex(), 'hex'));
const MAYOR_PUB = MAYOR.toPublicKey().toString();
const HIM_PUB = HIM.toPublicKey().toString();

interface Captured {
  posts: { scriptHex: string; auth: string }[];
  broadcasts: string[];
  sinces: number[];
}

let captured: Captured;
let payload: MessagePayload;
let records: { seq: number; txid: string; vout: number; payload: unknown }[];
let syncError: unknown;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function backend(options: { direct: boolean; everything401?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (options.everything401 && !url.pathname.endsWith('/challenge')) return json({ error: 'no licence held' }, 401);
    if (url.pathname.endsWith('/challenge')) return json({ nonce: crypto.randomUUID().replace(/-/g, '') });
    if (url.pathname.endsWith('/messages') && init?.method === 'POST') {
      if (!options.direct) return new Response('404 page not found', { status: 404 });
      const body = JSON.parse(String(init.body)) as { scriptHex: string };
      captured.posts.push({ scriptHex: body.scriptHex, auth: new Headers(init.headers).get('Authorization') ?? '' });
      return json({ txid: `direct:${'d'.repeat(64)}`, seq: 9 }, 201);
    }
    if (url.pathname.endsWith('/messages')) {
      const since = Number(url.searchParams.get('since') ?? '0');
      captured.sinces.push(since);
      const next = records.length ? Math.max(...records.map((r) => r.seq)) : since;
      return json({ records: records.filter((r) => r.seq > since), next });
    }
    if (url.pathname.includes('/utxos/')) return json({ utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 50_000, height: 1 }] });
    if (url.pathname.endsWith('/broadcast')) {
      const body = JSON.parse(String(init?.body)) as { rawtx: string };
      captured.broadcasts.push(body.rawtx);
      return json({ txid: Transaction.fromHex(body.rawtx).id('hex') });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

async function fresh(): Promise<void> {
  vi.unstubAllGlobals();
  await db.messages.clear();
  await db.settings.clear();
  await db.pendingSpends.clear();
  captured = { posts: [], broadcasts: [], sinces: [] };
  records = [];
  syncError = undefined;
}

function payloadOfScript(scriptHex: string): MessagePayload {
  const decoded = decodeRecordScript(LockingScript.fromHex(scriptHex));
  expect(decoded).not.toBeNull();
  return JSON.parse(Utils.toUTF8(Array.from(decoded!.payloadBytes))) as MessagePayload;
}

const options = () => ({ key: HIM_KEY, mayorKey: MAYOR_PUB, direct: true });

function fromMayor(text: string, to = HIM_PUB, cls: MessagePayload['class'] = 'message'): MessagePayload {
  return encryptMessage({ text, class: cls, senderPrivateKeyHex: MAYOR.toHex(), recipientPublicKeyHex: to });
}

async function syncAsHim(): Promise<void> {
  try {
    await syncMessages({ publicKeyHex: HIM_PUB, unlockedKey: HIM_KEY });
  } catch (err) {
    syncError = err;
  }
}

const feature = await loadFeature('features/messages.feature');

describeFeature(feature, ({ Scenario }) => {
  Scenario('AC-1: a text is encrypted so only the recipient key decrypts it', ({ Given, Then, And }) => {
    Given('a message "ship it" encrypted from his key to the Mayor', async () => {
      await fresh();
      payload = encryptMessage({ text: 'ship it', class: 'message', senderPrivateKeyHex: HIM.toHex(), recipientPublicKeyHex: MAYOR_PUB });
    });
    Then('the Mayor\'s key decrypts it to "ship it"', () => {
      expect(decryptMessage(payload, MAYOR.toHex())).toBe('ship it');
    });
    And('another key cannot decrypt it', () => {
      expect(() => decryptMessage(payload, SOMEONE.toHex())).toThrow();
    });
  });

  Scenario('AC-2: the class tag is readable without the key', ({ Given, Then }) => {
    Given('a "decision-needed" message encrypted from his key to the Mayor', async () => {
      await fresh();
      payload = encryptMessage({ text: '{}', class: 'decision-needed', senderPrivateKeyHex: HIM.toHex(), recipientPublicKeyHex: MAYOR_PUB });
    });
    Then('its class reads "decision-needed" without any key', () => {
      expect(JSON.parse(JSON.stringify(payload)).class).toBe('decision-needed');
    });
  });

  Scenario('plans/0021 AC-D1: a message is delivered directly as its record script, from his own key', ({ Given, When, Then, And }) => {
    Given('a backend that takes direct delivery', async () => {
      await fresh();
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('he sends "morning" to the Mayor', async () => {
      await deliver('morning', 'message', options());
    });
    Then('one POST to /api/messages carries a record script whose payload is from his key to the Mayor', () => {
      expect(captured.posts).toHaveLength(1);
      const sent = payloadOfScript(captured.posts[0].scriptHex);
      expect(sent.from).toBe(HIM_PUB);
      expect(sent.to).toBe(MAYOR_PUB);
      expect(decryptMessage(sent, MAYOR.toHex())).toBe('morning');
    });
    And('no transaction is built or broadcast', () => {
      expect(captured.broadcasts).toHaveLength(0);
    });
  });

  Scenario('plans/0021 AC-D2: an old backend without direct delivery gets a funded transaction instead', ({ Given, When, Then }) => {
    Given('a backend that answers 404 to POST /api/messages but has coins for him', async () => {
      await fresh();
      vi.stubGlobal('fetch', backend({ direct: false }));
    });
    When('he sends "morning" to the Mayor', async () => {
      await deliver('morning', 'message', options());
    });
    Then('the message is broadcast as a transaction', () => {
      expect(captured.broadcasts).toHaveLength(1);
      const tx = Transaction.fromHex(captured.broadcasts[0]);
      const sent = payloadOfScript(tx.outputs[0].lockingScript.toHex());
      expect(decryptMessage(sent, MAYOR.toHex())).toBe('morning');
    });
  });

  Scenario('plans/0021 AC-D3: what he sends is in its thread at once, before any sync', ({ Given, When, Then }) => {
    Given('a backend that takes direct delivery', async () => {
      await fresh();
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('he sends "about the stream" in the thread of bead "mw-f758y.30.2"', async () => {
      await deliverThreaded({ thread: { bead: 'mw-f758y.30.2' }, text: 'about the stream' }, options());
    });
    Then('a sent row with his own words is stored under thread "bead:mw-f758y.30.2"', async () => {
      const rows = await messagesRepo.getAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].direction).toBe('sent');
      expect(rows[0].thread).toBe('bead:mw-f758y.30.2');
      expect(rows[0].plaintext).toBe(encodeThreadedMessage({ thread: { bead: 'mw-f758y.30.2' }, text: 'about the stream' }));
    });
  });

  Scenario('mw-f758y.22.2 AC1: every call signs a fresh challenge', ({ Given, When, Then }) => {
    Given('a backend that takes direct delivery', async () => {
      await fresh();
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('he sends "one" and then "two" to the Mayor', async () => {
      await deliver('one', 'message', options());
      await deliver('two', 'message', options());
    });
    Then('each POST carried its own freshly signed challenge', () => {
      expect(captured.posts).toHaveLength(2);
      const nonces = captured.posts.map((post) => post.auth.split(':')[1]);
      expect(captured.posts.every((post) => post.auth.startsWith(`Postern ${HIM_PUB}:`))).toBe(true);
      expect(new Set(nonces).size).toBe(2);
    });
  });

  Scenario('AC-5: a record addressed to him is stored decrypted', ({ Given, When, Then }) => {
    Given('the backend holds a message from the Mayor to him saying "hello"', async () => {
      await fresh();
      records = [{ seq: 1, txid: `direct:${'1'.repeat(64)}`, vout: 0, payload: fromMayor('hello') }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('a received row reads "hello"', async () => {
      const rows = await messagesRepo.getAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].direction).toBe('received');
      expect(rows[0].plaintext).toBe('hello');
    });
  });

  Scenario('AC-6: a record addressed to someone else is not stored', ({ Given, When, Then }) => {
    Given('the backend holds a message from the Mayor to someone else', async () => {
      await fresh();
      records = [{ seq: 1, txid: 'a'.repeat(64), vout: 0, payload: fromMayor('not yours', SOMEONE.toPublicKey().toString()) }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('no row is stored', async () => {
      expect(await messagesRepo.getAll()).toHaveLength(0);
    });
  });

  Scenario('AC-7: the cursor advances so a second sync fetches nothing new', ({ Given, When, And, Then }) => {
    Given('the backend holds a message from the Mayor to him saying "hello"', async () => {
      await fresh();
      records = [{ seq: 4, txid: 'b'.repeat(64), vout: 0, payload: fromMayor('hello') }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    And('the messages are synced again', syncAsHim);
    Then("the second sync asked only for records after the first one's head", () => {
      expect(captured.sinces).toEqual([0, 4]);
    });
  });

  Scenario('AC-9: a record that fails to decrypt is kept, marked unreadable', ({ Given, When, Then }) => {
    Given('the backend holds a message addressed to him that his key cannot decrypt', async () => {
      await fresh();
      const garbled = { ...fromMayor('x'), ct: Utils.toBase64(Array.from({ length: 120 }, (_, i) => i)) };
      records = [{ seq: 1, txid: 'c'.repeat(64), vout: 0, payload: garbled }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('the row is kept and marked as failing to decrypt', async () => {
      const rows = await messagesRepo.getAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].decryptFailed).toBe(true);
    });
  });

  Scenario('mw-1589l.27 AC2: a message he sent is stored with his own words', ({ Given, When, Then }) => {
    Given('the backend holds a message he sent to the Mayor saying "on my way"', async () => {
      await fresh();
      const sent = encryptMessage({ text: 'on my way', class: 'message', senderPrivateKeyHex: HIM.toHex(), recipientPublicKeyHex: MAYOR_PUB });
      records = [{ seq: 1, txid: 'e'.repeat(64), vout: 0, payload: sent }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('a sent row reads "on my way"', async () => {
      const rows = await messagesRepo.getAll();
      expect(rows[0].direction).toBe('sent');
      expect(rows[0].plaintext).toBe('on my way');
    });
  });

  Scenario('mw-f758y.21.1 AC1: a message naming a bead thread is stored under that thread', ({ Given, When, Then }) => {
    Given('the backend holds a message from the Mayor in the thread of bead "mw-xyz.3"', async () => {
      await fresh();
      records = [{ seq: 1, txid: 'f'.repeat(64), vout: 0, payload: fromMayor(encodeThreadedMessage({ thread: { bead: 'mw-xyz.3' }, text: 'on it' })) }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('the row is stored under thread "bead:mw-xyz.3"', async () => {
      expect((await messagesRepo.getAll())[0].thread).toBe(threadKey({ bead: 'mw-xyz.3' }));
    });
  });

  Scenario('mw-f758y.21.1 AC2: a decision-needed message is stored under its own bead as its thread', ({ Given, When, Then }) => {
    Given('the backend holds a question from the Mayor about bead "mw-xyz.4"', async () => {
      await fresh();
      const question = fromMayor(encodeQuestion({ bead: 'mw-xyz.4', q: 'A or B?', rec: 'A', options: ['A', 'B'] }), HIM_PUB, 'decision-needed');
      records = [{ seq: 1, txid: '9'.repeat(64), vout: 0, payload: question }];
      vi.stubGlobal('fetch', backend({ direct: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('the row is stored under thread "bead:mw-xyz.4"', async () => {
      expect((await messagesRepo.getAll())[0].thread).toBe('bead:mw-xyz.4');
    });
  });

  Scenario('mw-f758y.22.2 AC3: a 401 while syncing is "Licence required"', ({ Given, When, Then }) => {
    Given('a backend that answers 401 to every call', async () => {
      await fresh();
      vi.stubGlobal('fetch', backend({ direct: true, everything401: true }));
    });
    When('the messages are synced with his key unlocked', syncAsHim);
    Then('the sync fails with "Licence required"', () => {
      expect(syncError).toBeInstanceOf(Error);
      expect((syncError as Error).message).toBe('Licence required');
    });
  });
});
