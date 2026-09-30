import { beforeEach, describe, expect, it } from 'vitest';
import { db, type MessageRow } from '../../src/data/db';
import { messagesRepo } from '../../src/data/repositories';
import { parseRoute } from '../../src/nav/route';
import { resolveTapUrl, threadUrlOfMessage } from '../../src/push/tapTarget';

const ROOT = `direct:${'a1'.repeat(32)}`;
const REPLY = `direct:${'b2'.repeat(32)}`;
const REPLY_TO_REPLY = `direct:${'c3'.repeat(32)}`;

function row(txid: string, body: object | string, extra: Partial<MessageRow> = {}): MessageRow {
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq: 1,
    class: 'message',
    to: 'aa'.repeat(33),
    from: 'bb'.repeat(33),
    ts: 1_790_000_000,
    ciphertext: 'ct',
    plaintext: typeof body === 'string' ? body : JSON.stringify(body),
    direction: 'received',
    read: false,
    ...extra,
  };
}

const route = (url: string) => parseRoute(new URL(url, 'https://postern.allmymind.org').search);

describe('resolveTapUrl: a reply opens the post it answers', () => {
  beforeEach(async () => {
    await db.messages.clear();
  });

  it('opens the reply thread of the root when the message is already stored', async () => {
    await messagesRepo.put(row(ROOT, 'the post'));
    await messagesRepo.put(row(REPLY, { text: 'the answer', re: ROOT }));
    const url = await resolveTapUrl({ txid: REPLY, class: 'message' });
    expect(route(url)).toEqual({ view: 'talk', thread: 'general', root: ROOT });
  });

  it('names the root, not the reply, when the message answers a reply', async () => {
    await messagesRepo.put(row(ROOT, 'the post'));
    await messagesRepo.put(row(REPLY, { text: 'the answer', re: ROOT }));
    await messagesRepo.put(row(REPLY_TO_REPLY, { text: 'and again', re: REPLY }));
    const url = await resolveTapUrl({ txid: REPLY_TO_REPLY, class: 'message' });
    expect(route(url)).toEqual({ view: 'talk', thread: 'general', root: ROOT });
  });

  it('treats the message as its own root (protocol §14) when the post it answers is not on the phone', async () => {
    await messagesRepo.put(row(REPLY, { text: 'the answer', re: ROOT }));
    const url = await resolveTapUrl({ txid: REPLY, class: 'message' });
    expect(route(url)).toEqual({ view: 'talk', thread: 'general', root: REPLY });
  });

  it('waits on the notice screen, which finds the thread once it arrives, for a message not stored yet', async () => {
    const url = await resolveTapUrl({ txid: REPLY, class: 'message', url: `/?v=notice&tx=${REPLY}&c=message` });
    expect(route(url)).toMatchObject({ view: 'notice', tx: REPLY });
  });

  it('the notice screen path: threadUrlOfMessage finds the root from the rows it holds', () => {
    const rows = [row(ROOT, 'the post'), row(REPLY, { text: 'the answer', re: ROOT }), row(REPLY_TO_REPLY, { text: 'x', re: REPLY })];
    const url = threadUrlOfMessage(rows[2], rows);
    expect(route(url!)).toEqual({ view: 'talk', thread: 'general', root: ROOT });
  });

  it('a message with no re still opens its channel', async () => {
    await messagesRepo.put(row(ROOT, 'just a post'));
    expect(route(await resolveTapUrl({ txid: ROOT, class: 'message' }))).toEqual({ view: 'talk', thread: 'general' });
    await messagesRepo.put(row(REPLY, { thread: { bead: 'mw-1' }, text: 'on a bead', re: ROOT }, { thread: 'bead:mw-1' }));
    expect(route(await resolveTapUrl({ txid: REPLY, class: 'message' }))).toEqual({ view: 'talk', thread: 'bead:mw-1' });
  });

  it('a transcript is an annotation, not a reply: it opens the channel', async () => {
    await messagesRepo.put(row(REPLY, { text: 'what he said', re: ROOT, role: 'transcript' }));
    expect(route(await resolveTapUrl({ txid: REPLY, class: 'message' }))).toEqual({ view: 'talk', thread: 'general' });
  });

  it('a chain of re that loops does not hang and opens the tapped message as the root', async () => {
    await messagesRepo.put(row(ROOT, { text: 'a', re: REPLY }));
    await messagesRepo.put(row(REPLY, { text: 'b', re: ROOT }));
    expect(route(await resolveTapUrl({ txid: REPLY, class: 'message' }))).toEqual({ view: 'talk', thread: 'general', root: REPLY });
  });
});
