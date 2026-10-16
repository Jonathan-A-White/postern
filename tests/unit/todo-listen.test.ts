// tests/unit/todo-listen.test.ts — mw-ev7oyy.24: a to-do's 'Listen in Audible' button, from audible-kit's audibleLink.
// An 'Audible: <ASIN>' line (or an audible.com/pd/<ASIN> link) opens the book; a 'Listen: <Book> <chapter>' line opens
// The Word of Promise at that chapter's start; 'Listen: <title> ch <n> | <start ms>' opens any Audible book at a chapter.
import { describe, expect, it } from 'vitest';
import { WORD_OF_PROMISE_ASIN, audibleLink, wordOfPromiseStart } from 'audible-kit';
import { listenHref, parseListenAction } from '../../src/todo';

const THEOLOGIAN = 'B0CC36V9KG';
const NOW = 1_760_000_000_000;

describe('the Audible: line', () => {
  it('opens the book where Audible left it, with audibleLink and no position', () => {
    const action = parseListenAction(`Read this.\n\nAudible: ${THEOLOGIAN}`);
    expect(action).toEqual({ asin: THEOLOGIAN });
    expect(listenHref(action!, NOW)).toBe(audibleLink({ asin: THEOLOGIAN, now: NOW }));
    expect(listenHref(action!, NOW)).toBe(
      'https://audible.smart.link/aexglzp2n?asin=B0CC36V9KG&autoplay=true&content_delivery_type=MultiPartBook&device_id=device_id&marketplace_domain=.com&site_id=1&source_code=Deep-link_Banner',
    );
  });

  it('reads the line set as a list item, a quote or in bold, and "single" for a book that is one file', () => {
    expect(parseListenAction(`- **Audible:** ${THEOLOGIAN}`)).toEqual({ asin: THEOLOGIAN });
    expect(parseListenAction(`> Audible: ${THEOLOGIAN} single`)).toEqual({ asin: THEOLOGIAN, single: true });
    expect(listenHref({ asin: THEOLOGIAN, single: true }, NOW)).toBe(audibleLink({ asin: THEOLOGIAN, contentDeliveryType: 'SinglePartBook', now: NOW }));
  });

  it('is not fooled by a line that is not an ASIN', () => {
    expect(parseListenAction('Audible: the new Keller book')).toBeUndefined();
    expect(parseListenAction('Audible: b0cc36v9kg')).toBeUndefined();
    expect(parseListenAction('Audible: B0CC36V9KG1')).toBeUndefined();
  });
});

describe('an audible.com/pd/<ASIN> link', () => {
  it('opens the book, wherever it is in the notes: bare, in an Open: line or with a title in the path', () => {
    for (const notes of [
      `Open: [Audible](https://www.audible.com/pd/${THEOLOGIAN})`,
      `See https://www.audible.com/pd/${THEOLOGIAN}?ref=x for it.`,
      `Open: [Audible](https://www.audible.com/pd/You-Are-a-Theologian-Audiobook/${THEOLOGIAN})`,
    ]) {
      expect(parseListenAction(notes)).toEqual({ asin: THEOLOGIAN });
    }
  });

  it('leaves out another site with the same path', () => {
    expect(parseListenAction(`https://notaudible.example/pd/${THEOLOGIAN}`)).toBeUndefined();
  });

  it('gives way to an Audible: line', () => {
    expect(parseListenAction(`Audible: B0F8C69PKX\nOpen: [x](https://www.audible.com/pd/${THEOLOGIAN})`)).toEqual({ asin: 'B0F8C69PKX' });
  });
});

describe('the Listen: line, The Word of Promise', () => {
  it('opens Luke 15 at its start, from audible-kit’s data', () => {
    const action = parseListenAction('Listen: Luke 15');
    expect(wordOfPromiseStart('Luke', 15)).toBe(300423039);
    expect(action).toEqual({ asin: WORD_OF_PROMISE_ASIN, positionMs: 300423039 });
    expect(listenHref(action!, NOW)).toBe(audibleLink({ asin: WORD_OF_PROMISE_ASIN, positionMs: 300423039, now: NOW }));
    const link = new URL(listenHref(action!, NOW));
    expect(link.searchParams.get('position_from_start')).toBe('300423039');
    expect(link.searchParams.get('annotation_time_utc')).toBe(String(NOW));
  });

  it('stamps the time of the tap: the link is built when asked, not when read', () => {
    const action = parseListenAction('Listen: Luke 15')!;
    expect(new URL(listenHref(action, 5)).searchParams.get('annotation_time_utc')).toBe('5');
    expect(new URL(listenHref(action, 9)).searchParams.get('annotation_time_utc')).toBe('9');
    const before = Date.now();
    const stamped = Number(new URL(listenHref(action)).searchParams.get('annotation_time_utc'));
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('knows the books by their Bible names, numbered ones, Psalm for Psalms, any case, and chapter or ch', () => {
    expect(parseListenAction('Listen: 1 Samuel 3')).toEqual({ asin: WORD_OF_PROMISE_ASIN, positionMs: wordOfPromiseStart('1 Samuel', 3) });
    expect(parseListenAction('Listen: Psalm 23')).toEqual({ asin: WORD_OF_PROMISE_ASIN, positionMs: wordOfPromiseStart('Psalms', 23) });
    expect(parseListenAction('Listen: john 3')).toEqual({ asin: WORD_OF_PROMISE_ASIN, positionMs: wordOfPromiseStart('John', 3) });
    expect(parseListenAction('Listen: Luke chapter 15')).toEqual(parseListenAction('Listen: Luke ch. 15'));
    expect(parseListenAction('Listen: Luke ch 15')).toEqual(parseListenAction('Listen: Luke 15'));
    expect(parseListenAction('Listen: Obadiah')).toEqual({ asin: WORD_OF_PROMISE_ASIN, positionMs: wordOfPromiseStart('Obadiah', 1) });
  });

  it('reads the line set as a list item or in bold', () => {
    expect(parseListenAction('- **Listen:** Luke 15')).toEqual(parseListenAction('Listen: Luke 15'));
  });

  it('shows no button for a chapter the Bible does not have, or a book that is not in it', () => {
    expect(parseListenAction('Listen: Luke 99')).toBeUndefined();
    expect(parseListenAction('Listen: Luke 0')).toBeUndefined();
    expect(parseListenAction('Listen: Hezekiah 3')).toBeUndefined();
  });

  it('a chapter it cannot find still opens the book named by an Audible: line, at the book', () => {
    expect(parseListenAction(`Audible: ${THEOLOGIAN}\nListen: Luke 99`)).toEqual({ asin: THEOLOGIAN });
  });
});

describe('the Listen: line, any Audible book', () => {
  const notes = `Audible: ${THEOLOGIAN} single\nListen: You Are a Theologian ch 6 | 7733124`;

  it('opens You Are a Theologian chapter 6 at 7733124, as proven on his phone', () => {
    const action = parseListenAction(notes);
    expect(action).toEqual({ asin: THEOLOGIAN, single: true, positionMs: 7733124 });
    expect(listenHref(action!, NOW)).toBe(audibleLink({ asin: THEOLOGIAN, positionMs: 7733124, contentDeliveryType: 'SinglePartBook', now: NOW }));
    const link = new URL(listenHref(action!, NOW));
    expect(link.searchParams.get('position_from_start')).toBe('7733124');
    expect(link.searchParams.get('content_delivery_type')).toBe('SinglePartBook');
    expect(link.searchParams.get('asin')).toBe(THEOLOGIAN);
  });

  it('takes the book from an audible.com/pd/ link too, and the start however the bar is spaced', () => {
    expect(parseListenAction(`Open: [A](https://www.audible.com/pd/${THEOLOGIAN})\nListen: You Are a Theologian ch 6|7733124`)).toEqual({ asin: THEOLOGIAN, positionMs: 7733124 });
  });

  it('without a start, or without a book, opens only the book (or nothing)', () => {
    expect(parseListenAction(`Audible: ${THEOLOGIAN}\nListen: You Are a Theologian ch 6`)).toEqual({ asin: THEOLOGIAN });
    expect(parseListenAction('Listen: You Are a Theologian ch 6 | 7733124')).toBeUndefined();
  });

  it('a start that is not a number of milliseconds is left out', () => {
    expect(parseListenAction(`Audible: ${THEOLOGIAN}\nListen: Book ch 6 | soon`)).toEqual({ asin: THEOLOGIAN });
    expect(parseListenAction(`Audible: ${THEOLOGIAN}\nListen: Book ch 6 | -5`)).toEqual({ asin: THEOLOGIAN });
  });
});

describe('a description with nothing to listen to', () => {
  it('has no action', () => {
    expect(parseListenAction('')).toBeUndefined();
    expect(parseListenAction('Just notes. Listen to Luke 15 sometime.')).toBeUndefined();
  });
});
