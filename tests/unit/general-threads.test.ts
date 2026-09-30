// mw-hkg17.1: a plain text message in General whose `re` names another General
// message is a reply in that message's thread, one level deep (docs/protocol.md §14).
import { describe, it, expect } from 'vitest';
import { mergeConversation } from '../../src/model/conversation';
import { groupGeneral } from '../../src/model/generalThreads';
import { encodeThreadedMessage } from '../../src/services/threads';
import type { MessageRow } from '../../src/data/db';

let seq = 0;
function row(plaintext: string, overrides: Partial<MessageRow> = {}): MessageRow {
  seq += 1;
  const txid = overrides.txid ?? `direct:${String(seq).padStart(64, '0')}`;
  return {
    id: `${txid}:0`,
    txid,
    vout: 0,
    seq,
    class: 'message',
    to: 't',
    from: 'f',
    ts: 1_760_000_000 + seq * 60,
    ciphertext: '',
    plaintext,
    direction: 'received',
    read: false,
    ...overrides,
  };
}

// encodeThreadedMessage writes bare text when there is no thread or attachment, dropping `re`;
// the Mayor's `mw postern send` writes this JSON itself, so the tests do too.
const say = (text: string, re?: string) => row(re === undefined ? text : JSON.stringify({ text, re }));

describe('groupGeneral', () => {
  it('puts two replies under their root, in time order, with a count and the last reply time', () => {
    const root = say('the post');
    const first = say('first answer', root.txid);
    const second = say('second answer', root.txid);
    const groups = groupGeneral(mergeConversation([second, root, first]));
    expect(groups).toHaveLength(1);
    expect(groups[0].root.text).toBe('the post');
    expect(groups[0].replies.map((item) => item.text)).toEqual(['first answer', 'second answer']);
    expect(groups[0].replyCount).toBe(2);
    expect(groups[0].lastReplyAt).toBe(second.ts * 1000);
  });

  it('keeps roots in time order, and a root with no replies has a count of 0 and no last reply', () => {
    const a = say('a');
    const b = say('b');
    const groups = groupGeneral(mergeConversation([b, a]));
    expect(groups.map((group) => group.root.text)).toEqual(['a', 'b']);
    expect(groups[0].replyCount).toBe(0);
    expect(groups[0].replies).toEqual([]);
    expect(groups[0].lastReplyAt).toBeUndefined();
  });

  it("puts a reply to a reply under the root, not under the reply", () => {
    const root = say('the post');
    const reply = say('an answer', root.txid);
    const deeper = say('an answer to the answer', reply.txid);
    const groups = groupGeneral(mergeConversation([root, reply, deeper]));
    expect(groups).toHaveLength(1);
    expect(groups[0].replies.map((item) => item.text)).toEqual(['an answer', 'an answer to the answer']);
    expect(groups[0].replyCount).toBe(2);
  });

  it('keeps a message whose re names a txid that is not there as a root', () => {
    const orphan = say('answering something unseen', `direct:${'e'.repeat(64)}`);
    const other = say('plain');
    const groups = groupGeneral(mergeConversation([orphan, other]));
    expect(groups.map((group) => group.root.text)).toEqual(['answering something unseen', 'plain']);
    expect(groups.every((group) => group.replyCount === 0)).toBe(true);
  });

  it('does not count a transcript as a reply', () => {
    const voice = row(encodeThreadedMessage({ text: '', attachment: { hash: 'h', size: 9, mime: 'audio/webm' } }), { direction: 'sent' });
    const transcript = row(JSON.stringify({ text: 'what was heard', re: voice.txid, role: 'transcript' }));
    const groups = groupGeneral(mergeConversation([voice, transcript]));
    expect(groups).toHaveLength(1);
    expect(groups[0].root).toMatchObject({ kind: 'attachment', transcript: 'what was heard' });
    expect(groups[0].replyCount).toBe(0);
  });

  it('matches txids regardless of case, and leaves a reply loop as roots', () => {
    const root = say('the post');
    const reply = say('an answer', root.txid.toUpperCase().replace('DIRECT:', 'direct:'));
    expect(groupGeneral(mergeConversation([root, reply]))[0].replyCount).toBe(1);

    const a = row(JSON.stringify({ text: 'a', re: `direct:${'0'.repeat(63)}9` }), { txid: `direct:${'0'.repeat(63)}8` });
    const b = row(JSON.stringify({ text: 'b', re: `direct:${'0'.repeat(63)}8` }), { txid: `direct:${'0'.repeat(63)}9` });
    const loop = groupGeneral(mergeConversation([a, b]));
    expect(loop.map((group) => group.root.text).sort()).toEqual(['a', 'b']);
  });
});
