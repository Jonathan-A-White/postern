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
