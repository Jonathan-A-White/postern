// mw-gq6.252: what Share hands the phone's share sheet: a message or card as the text he reads.
import { describe, it, expect } from 'vitest';
import { markdownToReadable } from '../../src/markdown/readable';
import { cardShareText, messageShareText, shareTitle } from '../../src/model/shareText';
import type { ConversationItem } from '../../src/model/conversation';
import type { LiveCard } from '../../src/model/cards';

const TXID = 'ab12'.repeat(16);

function item(over: Partial<ConversationItem>): ConversationItem {
  return { id: TXID, txid: TXID, at: 1, speaker: 'mayor', speakerLabel: 'Mayor', kind: 'text', text: '', source: 'message', ...over };
}

describe('markdownToReadable', () => {
  it('keeps paragraphs as lines and drops emphasis marks, headings and link targets', () => {
    expect(markdownToReadable('# Plan\n\nSee **the** [bead](https://x.example/k?key=SECRET) now')).toBe('Plan\n\nSee the bead now');
  });

  it('keeps a list as one line per item', () => {
    expect(markdownToReadable('Do:\n- one\n- two\n\n1. first\n2. second')).toBe('Do:\n- one\n- two\n\n1. first\n2. second');
  });

  it('keeps the lines of a code block exactly, without its fences', () => {
    expect(markdownToReadable('Run:\n```sh\ngit pull\n  npm ci && npm run build\n```\nDone')).toBe('Run:\ngit pull\n  npm ci && npm run build\nDone');
  });

  it('puts [diagram] where a mermaid block was and drops blockquote marks', () => {
    expect(markdownToReadable('> quoted\n```mermaid\nA-->B\n```')).toBe('quoted\n[diagram]');
  });
});

describe('messageShareText', () => {
  it('a plain message is its words', () => {
    expect(messageShareText(item({ text: 'Lunch is at noon.' }))).toBe('Lunch is at noon.');
  });

  it('a list message shares one line per item', () => {
    expect(messageShareText(item({ text: 'Bring:\n* tea\n* milk' }))).toBe('Bring:\n- tea\n- milk');
  });

  it('a message with a code block keeps the code lines', () => {
    expect(messageShareText(item({ text: 'Try:\n```\nls -la\ncd ..\n```' }))).toBe('Try:\nls -la\ncd ..');
  });

  it('a question card shares its question and each option as a line, marking the recommended one', () => {
    const question = { bead: 'mw-secret.1', q: 'Which **way**?', rec: 'A: Left', options: ['A: Left', 'B: Right'] };
    expect(messageShareText(item({ kind: 'question', text: question.q, question }))).toBe('Which way?\nA: Left (recommended)\nB: Right');
  });

  it('shares what was heard in a voice note when there are no words', () => {
    expect(messageShareText(item({ kind: 'attachment', text: '', transcript: 'call me back' }))).toBe('Heard: call me back');
  });

  it('shares nothing but the words: no txid, bead id, file hash or other hidden field', () => {
    const question = { bead: 'mw-hidden.9', q: 'Ship it?', rec: 'A: Yes', options: ['A: Yes', 'B: No'] };
    const shared = messageShareText(
      item({
        kind: 'question',
        text: question.q,
        question,
        re: 'cd34'.repeat(16),
        outboxId: 77,
        failure: 'secret failure',
        attachments: [{ hash: 'ee'.repeat(32), mime: 'image/png', size: 5, key: 'KEYMATERIAL' } as never],
      }),
    );
    for (const hidden of [TXID, 'cd34', 'mw-hidden', 'ee'.repeat(8), 'KEYMATERIAL', 'secret failure', 'http']) expect(shared).not.toContain(hidden);
  });
});

describe('cardShareText', () => {
  const card: LiveCard = {
    id: TXID,
    title: 'Friday jobs',
    prompt: 'hidden prompt',
    thread: 'bead:mw-hidden.1',
    sentAt: 1,
    items: [
      { n: 1, text: 'Pay the **rent**', links: ['mw-hidden.2'], done: true, doneAt: 5, since: 1, expect: { bead: 'mw-hidden.2', state: 'closed' } },
      { n: 2, text: 'Call [Luke](https://x.example/?k=1)', links: [], done: false, since: 1 },
    ],
    subscribe: { kinds: [], beads: ['mw-hidden.2'] },
    done: false,
    touchedAt: 1,
  };

  it('is the title and each item as a numbered line, marking the done ones', () => {
    expect(cardShareText(card)).toBe('Friday jobs\n1. Pay the rent (done)\n2. Call Luke');
  });

  it('carries no id, link, prompt or subscription', () => {
    const shared = cardShareText(card);
    for (const hidden of [TXID, 'mw-hidden', 'hidden prompt', 'http', 'bead:']) expect(shared).not.toContain(hidden);
  });
});

describe('shareTitle', () => {
  it('names the channel', () => {
    expect(shareTitle('Factory')).toBe('Postern: Factory');
    expect(shareTitle()).toBe('Postern');
  });
});
