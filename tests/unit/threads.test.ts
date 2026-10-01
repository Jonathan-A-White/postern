import { describe, it, expect } from 'vitest';
import { encodeQuestion, encodeReply } from '../../src/services/questions';
import {
  decodeThreadedMessage,
  encodeThreadedMessage,
  parseThreadKey,
  threadKey,
  threadOf,
  type ThreadedBody,
  type ThreadRef,
} from '../../src/services/threads';

describe('threads: encode/decode round trips', () => {
  it('round-trips a message with a bead thread', () => {
    const body: ThreadedBody = { thread: { bead: 'mw-xyz12.3' }, text: 'meet at the usual place' };
    expect(decodeThreadedMessage(encodeThreadedMessage(body))).toEqual(body);
  });

  it('round-trips a message with a topic thread', () => {
    const body: ThreadedBody = { thread: { topic: 'launch plan' }, text: 'ready when you are' };
    expect(decodeThreadedMessage(encodeThreadedMessage(body))).toEqual(body);
  });

  it('encodes a message with no thread as bare text, unchanged from today', () => {
    const encoded = encodeThreadedMessage({ text: 'no thread here' });
    expect(encoded).toBe('no thread here');
    expect(decodeThreadedMessage(encoded)).toEqual({ text: 'no thread here' });
  });

  it('round-trips a message with an attachment but no thread (mw-dxy1c.2)', () => {
    const body: ThreadedBody = {
      text: 'look at this',
      attachment: { hash: 'a'.repeat(64), size: 12345, mime: 'image/png' },
    };
    expect(decodeThreadedMessage(encodeThreadedMessage(body))).toEqual(body);
  });

  it('round-trips a message with both a thread and an attachment (mw-dxy1c.2)', () => {
    const body: ThreadedBody = {
      thread: { bead: 'mw-xyz12.3' },
      text: 'the screenshot',
      attachment: { hash: 'b'.repeat(64), size: 999, mime: 'image/jpeg' },
    };
    expect(decodeThreadedMessage(encodeThreadedMessage(body))).toEqual(body);
  });

  it('an attachment with an empty caption is valid (mw-dxy1c.2)', () => {
    const body: ThreadedBody = { text: '', attachment: { hash: 'c'.repeat(64), size: 1, mime: 'image/webp' } };
    expect(decodeThreadedMessage(encodeThreadedMessage(body))).toEqual(body);
  });

  describe('several files in one message (mw-909ci.3)', () => {
    const a = { hash: 'a'.repeat(64), size: 10, mime: 'image/png' };
    const b = { hash: 'b'.repeat(64), size: 20, mime: 'image/jpeg' };

    it('round-trips two files as `attachments`, in order, with thread and re', () => {
      const body: ThreadedBody = { thread: { bead: 'mw-x.1' }, text: 'both', attachments: [a, b], re: 'direct:' + 'e'.repeat(64) };
      const encoded = encodeThreadedMessage(body);
      const wire = JSON.parse(encoded) as Record<string, unknown>;
      expect(wire.attachments).toEqual([a, b]);
      expect(wire.attachment).toBeUndefined();
      expect(decodeThreadedMessage(encoded)).toEqual(body);
    });

    it('writes one file as the single `attachment`, never `attachments`', () => {
      const wire = JSON.parse(encodeThreadedMessage({ text: 'one', attachments: [a] })) as Record<string, unknown>;
      expect(wire.attachment).toEqual(a);
      expect(wire.attachments).toBeUndefined();
      expect(decodeThreadedMessage(JSON.stringify(wire))).toEqual({ text: 'one', attachment: a });
    });

    it('a reader that finds both fields uses `attachments`', () => {
      const text = JSON.stringify({ text: 't', attachment: a, attachments: [b, a] });
      expect(decodeThreadedMessage(text)).toEqual({ text: 't', attachments: [b, a] });
    });

    it('an empty or malformed `attachments` is plain text', () => {
      for (const attachments of [[], [a, { hash: 'x', size: 'big', mime: 'image/png' }], 'nope', { hash: 'x' }]) {
        const text = JSON.stringify({ text: 't', attachments });
        expect(decodeThreadedMessage(text)).toEqual({ text });
      }
    });
  });

  it('treats plain text as the general thread', () => {
    expect(decodeThreadedMessage('hello')).toEqual({ text: 'hello' });
  });

  it('treats JSON of some other shape as the general thread, text unchanged', () => {
    const text = JSON.stringify({ bead: 'mw-xyz12.3', answer: 'ship' });
    expect(decodeThreadedMessage(text)).toEqual({ text });
  });

  it('round-trips a bead thread key', () => {
    const thread: ThreadRef = { bead: 'mw-xyz12.3' };
    expect(parseThreadKey(threadKey(thread))).toEqual(thread);
  });

  it('round-trips a topic thread key', () => {
    const thread: ThreadRef = { topic: 'launch plan' };
    expect(parseThreadKey(threadKey(thread))).toEqual(thread);
  });

  it('the general thread has no key', () => {
    expect(threadKey(undefined)).toBeUndefined();
    expect(parseThreadKey(undefined)).toBeUndefined();
  });
});

describe('threadOf: docs/protocol.md §6', () => {
  it("reads a decision-needed message's own bead as its thread", () => {
    const plaintext = encodeQuestion({ bead: 'mw-xyz12.3', q: 'Ship now?', rec: 'ship', options: ['ship', 'wait'] });
    expect(threadOf('decision-needed', plaintext)).toEqual({ bead: 'mw-xyz12.3' });
  });

  it("reads a reply's own bead as its thread", () => {
    const plaintext = encodeReply({ bead: 'mw-xyz12.3', answer: 'ship' });
    expect(threadOf('message', plaintext)).toEqual({ bead: 'mw-xyz12.3' });
  });

  it('reads a threaded plain message', () => {
    const plaintext = encodeThreadedMessage({ thread: { topic: 'launch plan' }, text: 'ready when you are' });
    expect(threadOf('message', plaintext)).toEqual({ topic: 'launch plan' });
  });

  it('is the general thread for an unthreaded message', () => {
    expect(threadOf('message', 'meet at the usual place')).toBeUndefined();
  });

  it('is the general thread for an alarm', () => {
    expect(threadOf('alarm', 'evacuate the north tower')).toBeUndefined();
  });

  it('is the general thread when the message has not decrypted yet', () => {
    expect(threadOf('message', undefined)).toBeUndefined();
  });
});

describe('decodeThreadedMessage and §14 annotations (plans/0021)', () => {
  it('reads a general-thread transcript ({text, re, role}, no thread) as its text, never as JSON', () => {
    const body = decodeThreadedMessage(JSON.stringify({ text: 'heard this', re: 'direct:abc', role: 'transcript' }));
    expect(body).toEqual({ text: 'heard this', re: 'direct:abc', role: 'transcript' });
  });
});

describe('a message that carries re (mw-hkg17.2)', () => {
  it('is always JSON, never bare text, even with no thread or attachment', () => {
    const re = `direct:${'a'.repeat(64)}`;
    const encoded = encodeThreadedMessage({ text: 'an answer', re });
    expect(JSON.parse(encoded)).toEqual({ text: 'an answer', re });
    expect(decodeThreadedMessage(encoded)).toEqual({ text: 'an answer', re });
  });
});
