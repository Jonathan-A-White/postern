import { describe, it, expect } from 'vitest';
import { decryptMessage } from '../../src/services/messages';
import {
  decodeQuestion,
  decodeReply,
  decodeSnapshot,
  encodeQuestion,
  encodeReply,
  isStructured,
  type QuestionBody,
  type ReplyBody,
  type Snapshot,
} from '../../src/services/questions';

// docs/protocol.md §6's question and reply vectors — built with the same fixed
// keys as §5, one question and one reply, no new keys introduced.
const QUESTION_VECTOR = {
  recipientPrivateKeyHex: '0000000000000000000000000000000000000000000000000000000000000fa4',
  payload: {
    v: 1 as const,
    kind: 'msg' as const,
    class: 'decision-needed' as const,
    to: '02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471',
    from: '029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97',
    ts: 1758700800,
    ct: 'QkIQMwKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6lwKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cfUTYJju0iaS49EXvwfnOFzmhXmTg2rkY/fKFZoWPWIsnOlK+qTGT8mzFDsasyjArVmGLaN6keDBmn8ZIfxI188ceMVf3fH5lYyAHkijb5uR4kicdu5LSostB3XRPNRG/mHRhKgdfYFLR1jaUI0YhyQpegvb7HHEt1BJMypStI6QVsDa2beMuIwLtbqxPe3cPlQjPSx0xOyX+G2I35GTn4ed4yjqKBIFnlu6U1I8T6gGRi3eB8z2Idocga1v6yKsMSra77q67aRH',
  },
  expectedText: '{"bead":"mw-xyz12.3","q":"Ship the walking skeleton now, or wait for WireGuard?","rec":"ship","options":["ship","wait"]}',
  expectedBody: {
    bead: 'mw-xyz12.3',
    q: 'Ship the walking skeleton now, or wait for WireGuard?',
    rec: 'ship',
    options: ['ship', 'wait'],
  } satisfies QuestionBody,
};

const REPLY_VECTOR = {
  recipientPrivateKeyHex: '00000000000000000000000000000000000000000000000000000000000007d2',
  payload: {
    v: 1 as const,
    kind: 'msg' as const,
    class: 'message' as const,
    to: '029cbf013d04ca50ba852816c2802b06ca5ed37b44be9597fc0f95360e209afa97',
    from: '02874de6497645f144d1b63414c7b4310105089b0b4c6b6fb6e7da41125e90b471',
    ts: 1758700900,
    ct: 'QkIQMwKHTeZJdkXxRNG2NBTHtDEBBQibC0xrb7bn2kESXpC0cQKcvwE9BMpQuoUoFsKAKwbKXtN7RL6Vl/wPlTYOIJr6l9PDCCGbY3BqZlHrHfCoyORKwY0btt9/QgpmhChCxOi8NqdursM7raS+G938sW5LkBrVg9m8QRX5z+9ZljftaweMkdRKiRB1jaZ9zmbcHnFJZfg5ZzC3ZE+R9NB/5nJ7bfEJFoOo4vQgtg6kcFS/maO/8nS4Bw==',
  },
  expectedText: '{"bead":"mw-xyz12.3","answer":"ship"}',
  expectedBody: {
    bead: 'mw-xyz12.3',
    answer: 'ship',
  } satisfies ReplyBody,
};

describe('questions: docs/protocol.md §6 vectors', () => {
  it('decrypts and decodes the question vector', () => {
    const text = decryptMessage(QUESTION_VECTOR.payload, QUESTION_VECTOR.recipientPrivateKeyHex);
    expect(text).toBe(QUESTION_VECTOR.expectedText);
    expect(decodeQuestion(text)).toEqual(QUESTION_VECTOR.expectedBody);
  });

  it('decrypts and decodes the reply vector', () => {
    const text = decryptMessage(REPLY_VECTOR.payload, REPLY_VECTOR.recipientPrivateKeyHex);
    expect(text).toBe(REPLY_VECTOR.expectedText);
    expect(decodeReply(text)).toEqual(REPLY_VECTOR.expectedBody);
  });
});

describe('questions: encode/decode round trips', () => {
  it('round-trips a question', () => {
    const body: QuestionBody = {
      bead: 'mw-abcd1.2',
      q: 'Deploy tonight or wait for morning?',
      rec: 'wait',
      options: ['deploy', 'wait'],
    };
    expect(decodeQuestion(encodeQuestion(body))).toEqual(body);
  });

  it('round-trips a reply', () => {
    const body: ReplyBody = { bead: 'mw-abcd1.2', answer: 'wait' };
    expect(decodeReply(encodeReply(body))).toEqual(body);
  });

  it('round-trips a snapshot', () => {
    const snapshot: Snapshot = {
      written_at: '2026-09-24T20:00:00Z',
      epics: [
        {
          id: 'mw-f758y',
          title: 'Map: a licence-gated BSV PWA',
          priority: 'P2',
          status: 'in-progress',
          needs_you: [
            {
              id: 'mw-tfne4.1',
              title: 'docs/protocol.md gains the question body',
              asked_at: '2026-09-24T19:00:00Z',
              recommended: 'ship',
              options: ['ship', 'wait'],
            },
          ],
          landed: [{ id: 'mw-mol-twpyf', title: 'Implement until green', landed_at: '2026-09-24T18:00:00Z' }],
          working: [
            {
              id: 'mw-mol-yclf0',
              title: 'Run the full build, tests and vet',
              status: 'in-progress',
              priority: 'P1',
              updated_at: '2026-09-24T18:30:00Z',
              waits: [],
            },
          ],
          closed_count: 4,
        },
      ],
    };
    expect(decodeSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('treats plain text as unstructured', () => {
    expect(isStructured('hello')).toBe(false);
    expect(decodeQuestion('hello')).toBeUndefined();
    expect(decodeReply('hello')).toBeUndefined();
  });
});
