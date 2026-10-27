// tests/unit/long-message.test.ts — mw-fjpe9tx: his phone's outbox read 'Retrying in 24 s: Record payload is 21820 bytes,
// over the 10240-byte cap', then 'Retrying in 58 s: ...', for ever. spell-forge-bsv's encodeRecordScript throws on the phone,
// before any request, for a record whose payload is over 10,240 bytes; a typed message's payload is its text sealed and
// base64'd, a third bigger again, so about 16,000 bytes of his words made that one row unsendable. A message too long for one
// record now goes as several (docs/protocol.md §8, *A message in parts*), none cut, and the reader joins them back into one.
// The real sender, deliver, apiFetch, Dexie and spell-forge-bsv (its encoder watched); fetch and the live status are the doubles.
import { LockingScript, PrivateKey, Utils } from '@bsv/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeRecordScript } from 'spell-forge-bsv';
import { db, type MessageRow } from '../../src/data/db';
import { enqueue, forgetOutboxState, kickOutbox, settledOutbox } from '../../src/services/outbox';
import { decryptMessage, type MessagePayload } from '../../src/services/messages';
import { settledWrites } from '../../src/services/deliver';
import { mergeConversation, previewText } from '../../src/model/conversation';
import { decodeThreadedMessage, encodeThreadedMessage, messageRecords } from '../../src/services/threads';
import { RECORD_PLAINTEXT_MAX_BYTES } from '../../src/services/recordCap';
import { settlePhone } from '../support/empty-phone';
import { challengeResponse, isChallengeRequest } from '../support/challenge-fetch';

/** spell-forge-bsv's own cap on a record's payload (its record.js MAX_PAYLOAD_BYTES). */
const CAP = 10 * 1024;

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

const MAYOR_PRIVATE = '77'.repeat(32);
const held = vi.hoisted(() => ({ key: new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1)), mayorKey: '' }));
held.mayorKey = PrivateKey.fromHex(MAYOR_PRIVATE).toPublicKey().toString();

vi.mock('../../src/services/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/live')>()),
  deliverOptions: () => ({ key: held.key, mayorKey: held.mayorKey, direct: true, offline: false }),
  getLiveState: () => ({ status: 'live', me: null, reconnects: 0, syncs: 0, reached: true }),
}));
vi.mock('../../src/services/keySession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/keySession')>()),
  getKey: () => held.key,
}));

/** One record the fake backend took: its txid, the client id it came with, and what the Mayor reads in it. */
interface Taken {
  txid: string;
  clientId?: string;
  payload: MessagePayload;
  plaintext: string;
}

/** The fake backend: it opens each direct post as the Mayor's host does, and answers 503 to every post once it holds `busyAfter` records. Every post's client id is kept in `posted`. */
let backend: { taken: Taken[]; busyAfter?: number; posted: (string | undefined)[] };

/** His words that evening: about 16,000 bytes, as long as the row whose payload was 21,820 bytes. Several paragraphs, a few non-ASCII. */
function hisWords(bytes = 16_050): string {
  const paragraph = 'Here is what I think about the factory’s next week — the order of the stories, and why. ';
  let text = '';
  while (Utils.toArray(text, 'utf8').length < bytes) text += paragraph + (text.length % 3 === 0 ? '\n\n' : '');
  return text;
}

/** The records the backend took joined back as the Mayor's host joins them: by `split`, in `part` order. */
function joined(taken: Taken[]): { text: string; bodies: Record<string, unknown>[] } {
  const bodies = taken.map((record) => JSON.parse(record.plaintext) as Record<string, unknown>);
  const sorted = [...bodies].sort((a, b) => Number(a.part) - Number(b.part));
  return { text: sorted.map((body) => String(body.text)).join(''), bodies: sorted };
}

beforeEach(async () => {
  await settlePhone();
  forgetOutboxState();
  await db.outbox.clear();
  await db.messages.clear();
  encoded.sizes.length = 0;
  encoded.thrown.length = 0;
  backend = { taken: [], posted: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (isChallengeRequest(url)) return challengeResponse();
      if (url.endsWith('/messages') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { scriptHex: string; clientId?: string };
        backend.posted.push(body.clientId);
        if (backend.busyAfter !== undefined && backend.taken.length >= backend.busyAfter) return new Response(JSON.stringify({ error: 'busy' }), { status: 503 });
        const decoded = decodeRecordScript(LockingScript.fromHex(body.scriptHex));
        if (!decoded) throw new Error('not a record script');
        const payload = JSON.parse(Utils.toUTF8(decoded.payloadBytes)) as MessagePayload;
        // The backend keeps a retry of one client id once, and answers it with the first txid (docs/protocol.md §9).
        const again = body.clientId ? backend.taken.find((record) => record.clientId === body.clientId) : undefined;
        const txid = again?.txid ?? `direct:${String(backend.taken.length + 1).padStart(64, '0')}`;
        if (!again) backend.taken.push({ txid, ...(body.clientId ? { clientId: body.clientId } : {}), payload, plaintext: decryptMessage(payload, MAYOR_PRIVATE) });
        return new Response(JSON.stringify({ txid, seq: backend.taken.length }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  forgetOutboxState();
  await settlePhone();
  await db.outbox.clear();
  await db.messages.clear();
});

async function drained(): Promise<void> {
  kickOutbox(true);
  await settledOutbox();
  await settledWrites();
}

describe('a message too long for one record (mw-fjpe9tx)', () => {
  it('goes as several records, each within the cap, whose texts joined are his words', async () => {
    const words = hisWords();
    const id = await enqueue({ kind: 'message', payload: { text: words, files: [], thread: { topic: 'week' } }, thread: 'topic:week' });
    await drained();

    expect(encoded.thrown).toEqual([]);
    expect(Math.max(...encoded.sizes)).toBeLessThanOrEqual(CAP);
    expect(backend.taken.length).toBeGreaterThan(1);
    const { text, bodies } = joined(backend.taken);
    expect(text).toBe(words);
    // Every part names the same split, its place and the count, and stays in his thread.
    const parts = bodies.length;
    bodies.forEach((body, index) => expect(body).toMatchObject({ thread: { topic: 'week' }, part: index + 1, parts, split: bodies[0].split }));
    const row = await db.outbox.get(id);
    expect(row?.state).toBe('sent');
    expect(row?.error).toBeUndefined();
    // The row is the message: its txid is part 1's.
    expect(row?.txid).toBe(backend.taken[0].txid);
  });

  it('carries its files and its re on part 1 only', async () => {
    const words = hisWords(9_000);
    const file = { hash: 'ef'.repeat(32), size: 28, mime: 'image/jpeg', name: 'IMG_4471.jpg' };
    await enqueue({ kind: 'message', payload: { text: words, files: [{ name: 'IMG_4471.jpg', type: 'image/jpeg', data: btoa('jpeg') }], uploaded: [file], re: 'ab'.repeat(32) } });
    await drained();

    expect(encoded.thrown).toEqual([]);
    const { text, bodies } = joined(backend.taken);
    expect(text).toBe(words);
    expect(bodies[0]).toMatchObject({ attachment: file, re: 'ab'.repeat(32), part: 1 });
    for (const body of bodies.slice(1)) {
      expect(body).not.toHaveProperty('attachment');
      expect(body).not.toHaveProperty('re');
    }
  });

  it('a message that fits one record is unchanged on the wire: one record, no parts', async () => {
    await enqueue({ kind: 'message', payload: { text: 'did the deploy go?', files: [] } });
    await drained();
    expect(backend.taken.map((record) => record.plaintext)).toEqual(['did the deploy go?']);
  });

  it('a part that fails is tried again on its own: the parts already sent are not sent again', async () => {
    const words = hisWords();
    backend.busyAfter = 1;
    const id = await enqueue({ kind: 'message', payload: { text: words, files: [] } });
    await drained();
    expect((await db.outbox.get(id))?.state).toBe('pending');
    expect(backend.taken).toHaveLength(1);

    backend.busyAfter = undefined;
    await drained();
    expect((await db.outbox.get(id))?.state).toBe('sent');
    expect(joined(backend.taken).text).toBe(words);
    // Each part went under its own client id, and the retry began at part 2: part 1 was posted once.
    const ids = backend.taken.map((record) => record.clientId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(backend.posted.filter((posted) => posted === ids[0])).toHaveLength(1);
  });
});

describe('a message no record can hold (mw-fjpe9tx)', () => {
  it('is refused for good on the phone, in words, and not tried every minute', async () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ hash: 'ef'.repeat(32), size: i, mime: 'image/jpeg', name: `IMG_${i}.jpg` }));
    const id = await enqueue({ kind: 'message', payload: { text: hisWords(8_000), files: files.map((file) => ({ name: file.name, type: file.mime, data: btoa('jpeg') })), uploaded: files } });
    await drained();
    expect(await db.outbox.get(id)).toMatchObject({ state: 'failed', failure: expect.stringContaining('send fewer files') });
    expect(backend.taken).toEqual([]);
    expect(encoded.thrown).toEqual([]);
  });
});

describe('a row an older build queued over the cap (mw-fjpe9tx)', () => {
  it('goes by the new way on its next try, and no try throws over the cap', async () => {
    const words = hisWords();
    // His row as 0.8.57 kept it: one message, tried every minute, its error the encoder's own words.
    const id = (await db.outbox.add({
      kind: 'message',
      bead: '',
      payload: { text: words, files: [] },
      created: Date.now() - 3600_000,
      attempts: 7,
      nextAt: Date.now() + 58_000,
      state: 'pending',
      clientId: 'cd'.repeat(16),
      note: 'Record payload is 21820 bytes, over the 10240-byte cap',
      error: { message: 'Record payload is 21820 bytes, over the 10240-byte cap', at: Date.now() - 2000, attempt: 7 },
    })) as number;
    await drained();

    expect(encoded.thrown).toEqual([]);
    expect(Math.max(...encoded.sizes)).toBeLessThanOrEqual(CAP);
    expect(joined(backend.taken).text).toBe(words);
    const row = await db.outbox.get(id);
    expect(row).toMatchObject({ state: 'sent', txid: backend.taken[0].txid });
    expect(row?.error).toBeUndefined();
    expect(row?.note).toBeUndefined();
  });
});

describe('the reader (mw-fjpe9tx)', () => {
  it('shows a message in parts as one message, its text whole, in his thread and in its preview', async () => {
    const words = hisWords();
    await enqueue({ kind: 'message', payload: { text: words, files: [], thread: { topic: 'week' } }, thread: 'topic:week' });
    await drained();

    const stored = await db.messages.where('thread').equals('topic:week').toArray();
    expect(stored.length).toBe(backend.taken.length);
    const items = mergeConversation(stored);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', text: words, txid: backend.taken[0].txid, speaker: 'you' });
    expect(previewText(stored.find((row) => row.txid === items[0].txid) as MessageRow)).not.toContain('"split"');
  });

  it('joins the parts as they came back from the backend too, in any order, and says which part has not come', () => {
    const words = hisWords();
    const rows: MessageRow[] = backendRows(words);
    expect(mergeConversation([...rows].reverse())).toMatchObject([{ text: words }]);
    const missing = mergeConversation(rows.filter((_, index) => index !== 1));
    expect(missing).toHaveLength(1);
    expect(missing[0].text).toContain(`Missing part 2 of ${rows.length}.`);
  });
});

/** His message in parts as since-paging stores them on another phone of his: received rows, each with its own seq. */
function backendRows(words: string): MessageRow[] {
  const pieces = [words.slice(0, 7000), words.slice(7000, 14000), words.slice(14000)];
  return pieces.map((text, index) => ({
    id: `direct:${index}:0`,
    txid: `direct:${String(index + 1).padStart(64, '0')}`,
    vout: 0,
    seq: index + 1,
    class: 'message' as const,
    to: held.mayorKey,
    from: 'him',
    ts: 1761583500,
    ciphertext: '',
    plaintext: JSON.stringify({ text, split: 'ab'.repeat(16), part: index + 1, parts: pieces.length }),
    direction: 'received' as const,
    read: true,
  }));
}

describe('messageRecords and the part fields (mw-fjpe9tx)', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).length;

  it('keeps every record within RECORD_PLAINTEXT_MAX_BYTES, whatever the words are made of', () => {
    for (const text of [hisWords(30_000), '"\\'.repeat(9_000), '\u0001'.repeat(5_000), '😀'.repeat(4_000), 'x'.repeat(20_000)]) {
      const records = messageRecords({ thread: { bead: 'mw-abc' }, text, re: 'ab'.repeat(32) }, 'cd'.repeat(16));
      expect(records.length).toBeGreaterThan(1);
      for (const record of records) expect(bytes(encodeThreadedMessage(record))).toBeLessThanOrEqual(RECORD_PLAINTEXT_MAX_BYTES);
      expect(records.map((record) => record.text).join('')).toBe(text);
      expect(records.map((record) => decodeThreadedMessage(encodeThreadedMessage(record)))).toEqual(records);
    }
  });

  it('leaves a message that fits one record as it is, bare text when it was', () => {
    expect(messageRecords({ text: 'hello' }, 'id')).toEqual([{ text: 'hello' }]);
    expect(encodeThreadedMessage({ text: 'hello' })).toBe('hello');
  });

  it('refuses, in words, a message whose own fields leave part 1 no room', () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ hash: 'ef'.repeat(32), size: i, mime: 'image/jpeg', name: `IMG_${i}.jpg` }));
    expect(() => messageRecords({ text: hisWords(8_000), attachments: files }, 'id')).toThrow(/send fewer files/);
  });

  it('reads a malformed split as no split', () => {
    for (const fields of [{ split: '', part: 1, parts: 2 }, { split: 'a', part: 3, parts: 2 }, { split: 'a', part: 1, parts: 1 }, { split: 'a', part: 1.5, parts: 2 }]) {
      expect(decodeThreadedMessage(JSON.stringify({ text: 'x', ...fields }))).toEqual({ text: JSON.stringify({ text: 'x', ...fields }) });
    }
  });
});
